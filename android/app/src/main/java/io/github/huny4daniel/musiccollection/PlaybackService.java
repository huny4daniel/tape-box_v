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

import java.util.ArrayList;
import java.util.List;

/**
 * 실제 재생. 화면이 꺼지거나 앱을 내려도 다음 곡으로 넘어가고, 알림·잠금 화면에서 조작할 수 있다.
 * 들은 시간과 재생 횟수도 여기서 기록한다 (화면이 잠들어 있어도 빠지지 않게).
 */
public class PlaybackService extends MediaSessionService {
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
        });
        h.postDelayed(tick, 5000);
        restoreQueue();
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player != null && player.isPlaying()) {
                flushSegment();
                lisSince = SystemClock.elapsedRealtime();
                checkCount();
                prefs.edit().putLong("pos", player.getCurrentPosition()).apply();
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
        h.removeCallbacks(tick);
        if (player != null) { finishListen(); saveQueue(); TapeWidget.push(this, null); }
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
