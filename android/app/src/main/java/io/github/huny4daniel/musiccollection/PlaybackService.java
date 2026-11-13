package io.github.huny4daniel.musiccollection;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 실제 재생. 화면이 꺼지거나 앱을 내려도 다음 곡으로 넘어가고, 알림·잠금 화면에서 조작할 수 있다.
 * 들은 시간과 재생 횟수도 여기서 기록한다 (화면이 잠들어 있어도 빠지지 않게).
 */
public class PlaybackService extends MediaSessionService {
    private static volatile PlaybackService self; // PC에서 온 조작을 넘겨받을 곳 (NowSync)
    private ExoPlayer player;
    private MediaSession session;
    private final Handler h = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;

    // 들은 시간 기록
    private String lisId = null;
    private long lisMs = 0, lisSince = -1;
    private boolean lisCounted = false;

    @Override public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("playback", MODE_PRIVATE);
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player)
                .setSessionActivity(open)
                .setCallback(new MediaSession.Callback() {
                    // 화면은 곡 id만 보내므로 여기서 파일 주소·표시 정보를 채운다
                    @NonNull @Override
                    public ListenableFuture<List<MediaItem>> onAddMediaItems(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull List<MediaItem> items) {
                        List<MediaItem> out = new ArrayList<>();
                        for (MediaItem it : items) {
                            MediaItem r = App.get().library.toMediaItem(it.mediaId);
                            if (r != null) out.add(r);
                        }
                        return Futures.immediateFuture(out);
                    }
                })
                .build();
        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean playing) {
                if (playing) lisSince = SystemClock.elapsedRealtime();
                else { flushSegment(); checkCount(); saveQueue(); }
                TapeWidget.push(PlaybackService.this, player);
            }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                finishListen();
                lisId = item == null ? null : item.mediaId;
                if (player.isPlaying()) lisSince = SystemClock.elapsedRealtime();
                saveQueue();
                TapeWidget.push(PlaybackService.this, player);
            }
            @Override public void onTimelineChanged(@NonNull androidx.media3.common.Timeline t, int reason) { saveQueue(); }
            @Override public void onRepeatModeChanged(int mode) { saveQueue(); TapeWidget.push(PlaybackService.this, player); }
        });
        // PC·폰 재생 동기화: 폰에서 재생을 누르면(화면·알림·위젯) 폰이 소리를 맡고, 바뀐 상태를 알린다
        player.addListener(new Player.Listener() {
            @Override public void onPlayWhenReadyChanged(boolean play, int reason) {
                if (play) App.get().now.claim(NowSync.PHONE, null);
            }
            @Override public void onEvents(@NonNull Player p, @NonNull Player.Events ev) { publishNow(); }
        });
        self = this;
        h.postDelayed(tick, 5000);
        restoreQueue();
    }

    /** 폰이 소리를 맡고 있으면 지금 상태를 알린다 (PC 화면이 따라 움직인다) */
    private void publishNow() {
        if (player == null) return;
        try {
            JSONArray ids = new JSONArray();
            for (int i = 0; i < player.getMediaItemCount(); i++) ids.put(player.getMediaItemAt(i).mediaId);
            int st = player.getPlaybackState();
            long d = player.getDuration();
            int rm = player.getRepeatMode();
            JSONObject b = new JSONObject().put("ids", ids)
                    .put("index", player.getMediaItemCount() == 0 ? -1 : player.getCurrentMediaItemIndex())
                    .put("pos", player.getCurrentPosition())
                    .put("playing", player.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE)
                    .put("dur", d == C.TIME_UNSET ? 0 : d)
                    .put("repeat", rm == Player.REPEAT_MODE_ONE ? "one" : rm == Player.REPEAT_MODE_ALL ? "all" : "off");
            App.get().now.publish(NowSync.PHONE, b);
        } catch (Exception ignored) {}
    }

    /** 다른 기기(PC)의 조작을 재생기에 반영한다. 서버 스레드에서 불려도 재생기 스레드에서 처리한다 */
    static void remote(JSONObject c) {
        PlaybackService s = self;
        if (s != null) s.h.post(() -> s.applyRemote(c));
    }

    private void applyRemote(JSONObject c) {
        if (player == null) return;
        JSONObject m = c.optJSONObject("meta");
        if (m != null) Shuffle.set(this, m.optBoolean("shuffle", false), m.optJSONArray("orig") == null ? "[]" : m.optJSONArray("orig").toString());
        switch (c.optString("cmd")) {
            case "pause": player.pause(); break;
            case "play":
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(player.getCurrentMediaItemIndex(), 0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
                break;
            case "seek": player.seekTo(Math.max(0, c.optLong("ms", 0))); break;
            case "next":
                if (player.hasNextMediaItem()) player.seekToNextMediaItem();
                else if (player.getRepeatMode() == Player.REPEAT_MODE_ONE && player.getMediaItemCount() > 0) player.seekTo(0, 0);
                break;
            case "prev": player.seekToPrevious(); break;
            case "jump": { int i = c.optInt("i", -1); if (i >= 0 && i < player.getMediaItemCount()) player.seekTo(i, 0); break; }
            case "repeat": { String r = c.optString("m"); player.setRepeatMode("one".equals(r) ? Player.REPEAT_MODE_ONE : "all".equals(r) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF); break; }
            case "sync": syncQueue(items(c.optJSONArray("ids")), c.optInt("index", 0)); break;
            case "load": {
                List<MediaItem> list = items(c.optJSONArray("ids"));
                if (list.isEmpty()) { player.pause(); player.clearMediaItems(); break; }
                int i = Math.max(0, Math.min(list.size() - 1, c.optInt("index", 0)));
                player.setMediaItems(list, i, Math.max(0, c.optLong("pos", 0)));
                player.prepare();
                player.setPlayWhenReady(c.optBoolean("autoplay", false));
                break;
            }
            default: break;
        }
        publishNow(); // 이벤트가 생기지 않는 조작이어도 PC가 기다리지 않게
    }

    private static List<MediaItem> items(JSONArray a) {
        List<MediaItem> out = new ArrayList<>();
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            MediaItem m = App.get().library.toMediaItem(a.optString(i));
            if (m != null) out.add(m);
        }
        return out;
    }

    /** 지금 곡은 그대로 두고 앞뒤 대기열만 바꾼다 (화면의 syncQueue와 같은 방식) */
    private void syncQueue(List<MediaItem> list, int newIndex) {
        int cur = player.getCurrentMediaItemIndex(), n = player.getMediaItemCount();
        if (n == 0 || newIndex < 0 || newIndex >= list.size() || !list.get(newIndex).mediaId.equals(player.getMediaItemAt(cur).mediaId)) {
            if (list.isEmpty()) return;
            player.setMediaItems(list, Math.max(0, Math.min(list.size() - 1, newIndex)), player.getCurrentPosition());
            player.prepare();
            return;
        }
        if (cur + 1 < n) player.removeMediaItems(cur + 1, n);
        if (cur > 0) player.removeMediaItems(0, cur);
        if (newIndex > 0) player.addMediaItems(0, list.subList(0, newIndex));
        if (newIndex + 1 < list.size()) player.addMediaItems(list.subList(newIndex + 1, list.size()));
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player != null && player.isPlaying()) {
                flushSegment();
                lisSince = SystemClock.elapsedRealtime();
                checkCount();
                prefs.edit().putLong("pos", player.getCurrentPosition()).apply();
                publishNow(); // 재생 위치가 조금씩 어긋나지 않게 가끔 다시 맞춘다
                TapeWidget.push(PlaybackService.this, player); // 감긴 테이프 양 (같은 단계면 다시 그리지 않음)
            }
            h.postDelayed(this, 5000);
        }
    };

    private void flushSegment() {
        if (lisSince >= 0) { lisMs += SystemClock.elapsedRealtime() - lisSince; lisSince = -1; }
    }

    /** 30초 또는 곡 절반(짧은 쪽)을 들으면 한 번 들은 것으로 친다 (화면 쪽 규칙과 같음) */
    private void checkCount() {
        if (lisId == null || lisCounted) return;
        long dur = player.getDuration();
        long need = Math.min(30000, Math.max(5000, dur > 0 ? dur / 2 : 30000));
        if (lisMs >= need) {
            lisCounted = true;
            App.get().db.recordPlay(lisId, lisMs, true);
            PlaylistExport.schedule(App.get()); // 이번 달 히스토리 테이프가 바뀌었을 수 있다
            App.get().emit("{\"type\":\"played\",\"id\":\"" + lisId + "\"}");
            App.get().emit("{\"type\":\"listened\",\"id\":\"" + lisId + "\",\"ms\":" + lisMs + "}");
            lisMs = 0;
        }
    }

    private void finishListen() {
        flushSegment();
        checkCount();
        if (lisId != null && lisMs > 1500) {
            App.get().db.recordPlay(lisId, lisMs, false);
            App.get().emit("{\"type\":\"listened\",\"id\":\"" + lisId + "\",\"ms\":" + lisMs + "}");
        }
        lisMs = 0; lisCounted = false; lisSince = -1;
    }

    // 앱이 완전히 꺼졌다 켜져도 대기열을 되살린다 (멈춘 상태로)
    private void saveQueue() {
        if (player == null) return;
        JSONArray ids = new JSONArray();
        for (int i = 0; i < player.getMediaItemCount(); i++) ids.put(player.getMediaItemAt(i).mediaId);
        prefs.edit().putString("ids", ids.toString()).putInt("index", player.getCurrentMediaItemIndex())
                .putLong("pos", player.getCurrentPosition()).putInt("repeat", player.getRepeatMode()).apply();
    }

    private void restoreQueue() {
        App.get().io.execute(() -> {
            if (!App.get().library.isScanned()) App.get().library.scan();
            h.post(() -> {
                if (player == null || player.getMediaItemCount() > 0) return;
                try {
                    JSONArray ids = new JSONArray(prefs.getString("ids", "[]"));
                    List<MediaItem> items = new ArrayList<>();
                    int index = prefs.getInt("index", 0), newIndex = 0;
                    for (int i = 0; i < ids.length(); i++) {
                        MediaItem m = App.get().library.toMediaItem(ids.getString(i));
                        if (m == null) continue;
                        if (i == index) newIndex = items.size();
                        items.add(m);
                    }
                    if (items.isEmpty()) return;
                    player.setRepeatMode(prefs.getInt("repeat", Player.REPEAT_MODE_OFF));
                    player.setMediaItems(items, newIndex, prefs.getLong("pos", 0));
                    player.prepare();
                    TapeWidget.push(this, player);
                } catch (Exception ignored) {}
            });
        });
    }

    @Nullable @Override public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo info) { return session; }

    @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
        if (player == null || !player.getPlayWhenReady() || player.getMediaItemCount() == 0) stopSelf();
    }

    @Override public void onDestroy() {
        self = null;
        h.removeCallbacks(tick);
        if (player != null) {
            finishListen(); saveQueue(); TapeWidget.push(this, null);
            try { App.get().now.publish(NowSync.PHONE, new JSONObject().put("playing", false).put("pos", player.getCurrentPosition())); } catch (Exception ignored) {}
        }
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
