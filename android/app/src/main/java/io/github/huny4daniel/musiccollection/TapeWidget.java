package io.github.huny4daniel.musiccollection;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.Log;
import android.widget.RemoteViews;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 홈 화면 위젯: 재생 화면과 같은 카세트가 돌아가고, 아래 워크맨 건반으로 곡을 넘긴다.
 * 카세트(라벨·글씨·감긴 테이프)는 그림 한 장으로 그리고, 릴은 같은 비율의 벡터 6장을 번갈아 보여 돌린다.
 */
public class TapeWidget extends AppWidgetProvider {
    private static final String TAG = "TapeWidget";
    static final String ACT_PREV = "io.github.huny4daniel.musiccollection.widget.PREV";
    static final String ACT_TOGGLE = "io.github.huny4daniel.musiccollection.widget.TOGGLE";
    static final String ACT_NEXT = "io.github.huny4daniel.musiccollection.widget.NEXT";

    private static final ExecutorService draw = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    // 같은 곡·비슷한 진행도면 그림을 다시 그리지 않는다
    private static String cacheKey = null;
    private static Bitmap cacheBmp = null;
    private static Typeface pen = null;
    private static String lastSent = null; // 마지막으로 위젯에 보낸 상태 (같으면 다시 보내지 않는다)

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("widget", Context.MODE_PRIVATE); }

    // ───────── 재생 서비스·화면이 알려 주는 상태 ─────────

    /** 재생 서비스에서 곡·재생 상태·진행이 바뀔 때 부른다 (메인 스레드) */
    static void push(Context ctx, @Nullable Player p) {
        Context c = ctx.getApplicationContext();
        SharedPreferences.Editor e = prefs(c).edit();
        MediaItem item = p == null ? null : p.getCurrentMediaItem();
        if (item != null) {
            Track t = App.get().library.get(item.mediaId);
            CharSequence title = item.mediaMetadata.title, artist = item.mediaMetadata.artist;
            long dur = p.getDuration();
            e.putString("id", item.mediaId)
                    .putString("title", t != null ? t.title : title == null ? "" : title.toString())
                    .putString("artist", t != null ? t.artist : artist == null ? "" : artist.toString())
                    .putString("albumKey", t != null ? t.albumKey : "")
                    .putFloat("p", dur > 0 ? Math.max(0f, Math.min(1f, p.getCurrentPosition() / (float) dur)) : 0f)
                    .putInt("no", p.getCurrentMediaItemIndex() + 1);
        }
        e.putBoolean("playing", p != null && p.isPlaying()).apply();
        refresh(c, false);
    }

    /** 화면에서 재생을 시작할 때 테이프 이름(재생목록 이름)을 알려 준다 */
    static void setTapeName(Context ctx, String name) {
        Context c = ctx.getApplicationContext();
        prefs(c).edit().putString("tape", name == null ? "" : name).apply();
        refresh(c, false);
    }

    static void refresh(Context c, boolean force) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TapeWidget.class));
        if (ids == null || ids.length == 0) return;
        draw.execute(() -> {
            try {
                SharedPreferences s = prefs(c);
                String sig = s.getString("id", "") + "|" + s.getString("tape", "") + "|" + Math.round(s.getFloat("p", 0f) * 24)
                        + "|" + s.getInt("no", 0) + "|" + s.getBoolean("playing", false);
                if (!force && sig.equals(lastSent)) return;
                lastSent = sig;
                RemoteViews v = build(c);
                main.post(() -> m.updateAppWidget(ids, v));
            } catch (Exception e) { Log.w(TAG, "update failed", e); }
        });
    }

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { refresh(c, true); }

    // ───────── 건반 → 재생 서비스 ─────────

    @Override public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (!ACT_PREV.equals(a) && !ACT_TOGGLE.equals(a) && !ACT_NEXT.equals(a)) return;
        Context c = ctx.getApplicationContext();
        PendingResult done = goAsync();
        SessionToken token = new SessionToken(c, new ComponentName(c, PlaybackService.class));
        ListenableFuture<MediaController> f = new MediaController.Builder(c, token).buildAsync();
        f.addListener(() -> {
            MediaController mc;
            try { mc = f.get(); } catch (Exception e) { Log.w(TAG, "controller", e); done.finish(); return; }
            Runnable finish = () -> main.postDelayed(() -> { mc.release(); done.finish(); }, 400);
            Runnable act = () -> { command(mc, a); finish.run(); };
            if (mc.getMediaItemCount() > 0) { act.run(); return; }
            // 앱이 꺼져 있었다면 재생 서비스가 지난 대기열을 되살릴 때까지 잠깐 기다린다
            final boolean[] ran = {false};
            Player.Listener l = new Player.Listener() {
                @Override public void onTimelineChanged(Timeline t, int reason) {
                    if (ran[0] || mc.getMediaItemCount() == 0) return;
                    ran[0] = true; mc.removeListener(this); act.run();
                }
            };
            mc.addListener(l);
            main.postDelayed(() -> { if (!ran[0]) { ran[0] = true; mc.removeListener(l); finish.run(); } }, 4000);
        }, c.getMainExecutor());
    }

    private static void command(MediaController c, String a) {
        if (ACT_PREV.equals(a)) c.seekToPrevious();
        else if (ACT_NEXT.equals(a)) { if (c.hasNextMediaItem()) c.seekToNextMediaItem(); }
        else if (c.isPlaying()) c.pause();
        else {
            if (c.getPlaybackState() == Player.STATE_ENDED) c.seekTo(c.getCurrentMediaItemIndex(), 0);
            if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare();
            c.play();
        }
    }

    private static PendingIntent key(Context c, String action, int code) {
        Intent i = new Intent(c, TapeWidget.class).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews build(Context c) {
        SharedPreferences s = prefs(c);
        boolean playing = s.getBoolean("playing", false);
        RemoteViews v = new RemoteViews(c.getPackageName(), playing ? R.layout.widget_tape_play : R.layout.widget_tape_pause);
        v.setImageViewBitmap(R.id.w_tape, tapeBitmap(c, s));
        v.setImageViewResource(R.id.w_toggle, playing ? R.drawable.wm_ic_pause : R.drawable.wm_ic_play);
        v.setOnClickPendingIntent(R.id.w_prev, key(c, ACT_PREV, 1));
        v.setOnClickPendingIntent(R.id.w_toggle, key(c, ACT_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.w_next, key(c, ACT_NEXT, 3));
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.w_tape_area, PendingIntent.getActivity(c, 4, open, PendingIntent.FLAG_IMMUTABLE));
        return v;
    }

    // ───────── 카세트 그림 (재생 화면의 css/cassette.css와 같은 치수, 640×400 기준) ─────────

    private static final int W = 640, H = 400;
    private static final float SCALE = 1.1f; // 실제 그림 704×440 (위젯 전송 한도 안에서 선명하게)
    // 릴 중심 — res/drawable/widget_reels_*.xml 과 같아야 한다
    private static final float RL = 209.3f, RR = 430.7f, RY = 181.6f;

    private static Bitmap tapeBitmap(Context c, SharedPreferences s) {
        String id = s.getString("id", ""), title = s.getString("title", ""), artist = s.getString("artist", "");
        String albumKey = s.getString("albumKey", ""), tape = s.getString("tape", "");
        float p = Math.round(s.getFloat("p", 0f) * 24) / 24f; // 감긴 양은 24단계로만
        String k = id + "|" + tape + "|" + p + "|" + s.getInt("no", 0);
        if (k.equals(cacheKey) && cacheBmp != null) return cacheBmp;

        // 모서리까지 위젯 바탕색으로 칠해 불투명하게(RGB_565) 만들면 전송 크기가 절반이 된다
        Bitmap bmp = Bitmap.createBitmap(Math.round(W * SCALE), Math.round(H * SCALE), Bitmap.Config.RGB_565);
        Canvas cv = new Canvas(bmp);
        cv.drawColor(0xFF1A1612);
        cv.scale(SCALE, SCALE);
        Paint pt = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        int hue = Math.floorMod((tape.isEmpty() ? albumKey : tape).hashCode(), 360);

        // 몸체: 연기색 플라스틱
        RectF body = new RectF(0, 0, W, H);
        pt.setShader(new LinearGradient(0, 0, 0, H, new int[]{0xFF3D3935, 0xFF2C2926, 0xFF4A4540, 0xFF34302C}, new float[]{0, .70f, .74f, 1}, Shader.TileMode.CLAMP));
        cv.drawRoundRect(body, 10, 10, pt);
        pt.setShader(new LinearGradient(0, 0, 0, 32, 0x12FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
        cv.drawRoundRect(body, 10, 10, pt);
        pt.setShader(null);
        stroke(cv, pt, new RectF(.8f, .8f, W - .8f, H - .8f), 10, 1.6f, 0x59000000);
        // 나사
        for (float[] sc : new float[][]{{20.5f, 20}, {619.5f, 20}, {20.5f, 380}, {619.5f, 380}}) screw(cv, pt, sc[0], sc[1], 9.6f);
        screw(cv, pt, 320, 320, 7f);
        // 아래 받침 (헤드 구멍)
        Path foot = new Path();
        foot.moveTo(134.4f + 15f, 316.8f); foot.lineTo(505.6f - 15f, 316.8f); foot.lineTo(505.6f, 400); foot.lineTo(134.4f, 400); foot.close();
        pt.setShader(new LinearGradient(0, 316.8f, 0, 400, 0x805A544D, 0xD9221F1C, Shader.TileMode.CLAMP));
        cv.drawPath(foot, pt);
        pt.setShader(null);
        pt.setColor(0xFF0C0B0A);
        cv.drawCircle(184, 352, 9, pt); cv.drawCircle(456, 352, 9, pt);
        cv.drawRoundRect(new RectF(270, 346, 282, 358), 2, 2, pt); cv.drawRoundRect(new RectF(358, 346, 370, 358), 2, 2, pt);

        // 라벨 = 앨범아트를 인쇄한 종이
        RectF label = new RectF(32, 28, 608, 303);
        cv.save();
        Path lp = new Path(); lp.addRoundRect(label, 4.5f, 4.5f, Path.Direction.CW);
        cv.clipPath(lp);
        pt.setColor(Color.HSVToColor(new float[]{hue, .35f, .42f}));
        cv.drawRect(label, pt);
        Bitmap art = loadArt(albumKey);
        if (art != null) {
            ColorMatrix cm = new ColorMatrix(); cm.setSaturation(.85f);
            ColorMatrix sepia = new ColorMatrix(new float[]{
                    .93f, .07f, .02f, 0, 6, .03f, .93f, .03f, 0, 3, .02f, .05f, .88f, 0, 0, 0, 0, 0, 1, 0});
            cm.postConcat(sepia);
            pt.setColorFilter(new ColorMatrixColorFilter(cm));
            float sc = Math.max(label.width() / art.getWidth(), label.height() / art.getHeight());
            float dw = art.getWidth() * sc, dh = art.getHeight() * sc;
            cv.drawBitmap(art, null, new RectF(label.centerX() - dw / 2, label.centerY() - dh / 2, label.centerX() + dw / 2, label.centerY() + dh / 2), pt);
            pt.setColorFilter(null);
            art.recycle();
        }
        // 바랜 종이 느낌
        pt.setShader(new LinearGradient(0, label.top, 0, label.bottom, new int[]{0x24FFF4DE, 0x00FFF4DE, 0x38321F0F}, new float[]{0, .4f, 1}, Shader.TileMode.CLAMP));
        cv.drawRect(label, pt);
        pt.setShader(null);

        // 창: 반투명 플라스틱 너머로 감긴 테이프와 릴
        RectF win = new RectF(164.5f, 133.6f, 475.5f, 229.6f);
        pt.setColor(0x38000000); cv.drawRoundRect(grow(win, 8.6f), 9, 9, pt);
        pt.setColor(0xF2EEE5D2); cv.drawRoundRect(grow(win, 7f), 8, 8, pt);
        cv.save();
        Path wp = new Path(); wp.addRoundRect(win, 5, 5, Path.Direction.CW);
        cv.clipPath(wp);
        pt.setShader(new LinearGradient(0, win.top, 0, win.bottom, 0xCC403933, 0xE028231F, Shader.TileMode.CLAMP));
        cv.drawRect(win, pt);
        pt.setShader(new LinearGradient(win.left, win.top, win.left + 60, win.bottom, 0x1FFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
        cv.drawRect(win, pt);
        pt.setShader(new LinearGradient(0, win.top, 0, win.top + 10, 0x80000000, 0x00000000, Shader.TileMode.CLAMP));
        cv.drawRect(win, pt);
        pt.setShader(null);
        pt.setColor(0xFF2D2119);
        cv.drawRect(win.left + win.width() * .18f, win.bottom - 9.6f - 4.5f, win.right - win.width() * .18f, win.bottom - 9.6f, pt);
        wound(cv, pt, RL, 3.2f + (1 - p) * 17.3f);
        wound(cv, pt, RR, 3.2f + p * 17.3f);
        cv.restore();

        // 라벨 아래 띠: 곡 제목 + 가수
        RectF band = new RectF(label.left, label.bottom - 51, label.right, label.bottom);
        pt.setColor(Color.HSVToColor(new float[]{(hue + 28) % 360, .55f, .70f})); cv.drawRect(band.left, band.top - 9.6f, band.right, band.top, pt);
        pt.setColor(0xF2EEE5D2); cv.drawRect(band.left, band.top - 7f, band.right, band.top, pt);
        pt.setColor(Color.HSVToColor(new float[]{hue, .55f, .58f})); cv.drawRect(band.left, band.top - 3.5f, band.right, band.top, pt);
        pt.setColor(0xF2EEE5D2); cv.drawRect(band, pt);
        TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        float x = band.left + 21.8f, base = band.centerY() + 8.5f, room = band.width() - 43.6f;
        int no = s.getInt("no", 0);
        if (no > 0) {
            tp.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)); tp.setTextSize(20f); tp.setColor(0xFF6B5A48);
            String ns = "#" + no; cv.drawText(ns, x, base, tp); float w = tp.measureText(ns) + 10; x += w; room -= w;
        }
        tp.setTypeface(Typeface.DEFAULT_BOLD); tp.setTextSize(23.7f); tp.setColor(0xFF2A2218);
        String tt = TextUtils.ellipsize(title.isEmpty() ? "빈 테이프" : title, tp, room * .72f, TextUtils.TruncateAt.END).toString();
        cv.drawText(tt, x, base, tp);
        float used = tp.measureText(tt) + 10;
        tp.setTypeface(Typeface.DEFAULT); tp.setTextSize(18.6f); tp.setColor(0xFF6B5A48);
        if (room - used > 30) cv.drawText(TextUtils.ellipsize(artist, tp, room - used, TextUtils.TruncateAt.END).toString(), x + used, base, tp);
        cv.restore(); // 라벨 클립 끝

        // 마스킹 테이프 + 손글씨 제목 (테이프 이름, 없으면 곡 제목)
        String name = tape.isEmpty() ? (title.isEmpty() ? "나의 믹스테이프" : title) : tape;
        TextPaint hp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        hp.setTypeface(penFont(c)); hp.setTextSize(51f); hp.setColor(0xFF1F2D4D);
        name = TextUtils.ellipsize(name, hp, label.width() * .7f - 54, TextUtils.TruncateAt.END).toString();
        float tw = hp.measureText(name) + 54, th = 51 * 1.12f + 3.8f;
        float tilt = (Math.floorMod(name.hashCode() >> 4, 7) - 3) * .5f;
        cv.save();
        cv.rotate(tilt, label.centerX(), label.top + 19 + th / 2);
        float tl = label.centerX() - tw / 2, tt0 = label.top + 19;
        Path mt = torn(tl, tt0, tw, th);
        pt.setColor(0xF0E7DBBC);
        pt.setShadowLayer(2.2f, 0, 1.9f, 0x59000000);
        cv.drawPath(mt, pt);
        pt.clearShadowLayer();
        pt.setShader(new LinearGradient(0, tt0, 0, tt0 + th, new int[]{0x38FFFFFF, 0x00FFFFFF, 0x14785F32}, new float[]{0, .45f, 1}, Shader.TileMode.CLAMP));
        cv.drawPath(mt, pt);
        pt.setShader(null);
        Paint.FontMetrics fm = hp.getFontMetrics();
        cv.drawText(name, tl + 27, tt0 + 3.2f + (th - 3.8f) / 2 - (fm.ascent + fm.descent) / 2, hp);
        cv.restore();

        cacheKey = k;
        cacheBmp = bmp;
        return bmp;
    }

    private static RectF grow(RectF r, float d) { return new RectF(r.left - d, r.top - d, r.right + d, r.bottom + d); }

    private static void stroke(Canvas cv, Paint pt, RectF r, float rad, float w, int color) {
        pt.setStyle(Paint.Style.STROKE); pt.setStrokeWidth(w); pt.setColor(color);
        cv.drawRoundRect(r, rad, rad, pt);
        pt.setStyle(Paint.Style.FILL);
    }

    private static void screw(Canvas cv, Paint pt, float x, float y, float r) {
        pt.setColor(0xFF3A3632); cv.drawCircle(x, y, r, pt);
        pt.setColor(0xFF8D877F); cv.drawCircle(x, y, r * .83f, pt);
        pt.setColor(0xFF0B0A09); cv.drawCircle(x, y, r * .47f, pt);
    }

    /** 릴 둘레에 감긴 테이프 (릴 바깥 반지름 23에서 두께만큼) */
    private static void wound(Canvas cv, Paint pt, float cx, float thick) {
        pt.setStyle(Paint.Style.STROKE);
        pt.setColor(0x59000000); pt.setStrokeWidth(thick + .64f); cv.drawCircle(cx, RY, 23 + (thick + .64f) / 2, pt);
        pt.setColor(0xFF2D2119); pt.setStrokeWidth(thick); cv.drawCircle(cx, RY, 23 + thick / 2, pt);
        pt.setStyle(Paint.Style.FILL);
    }

    /** 손으로 찢은 양 끝 (cassette.css의 .mtape clip-path와 같은 꼭짓점) */
    private static Path torn(float l, float t, float w, float h) {
        float[][] pts = {{0, 0}, {1, 0}, {.986f, .14f}, {1, .30f}, {.989f, .47f}, {1, .63f}, {.985f, .80f}, {1, 1}, {0, 1}, {.013f, .85f}, {0, .67f}, {.011f, .50f}, {0, .34f}, {.014f, .17f}};
        Path p = new Path();
        for (int i = 0; i < pts.length; i++) {
            float x = l + pts[i][0] * w, y = t + pts[i][1] * h;
            if (i == 0) p.moveTo(x, y); else p.lineTo(x, y);
        }
        p.close();
        return p;
    }

    private static Typeface penFont(Context c) {
        if (pen == null) {
            try { pen = Typeface.createFromAsset(c.getAssets(), "fonts/NanumPenScript-Regular.ttf"); }
            catch (Exception e) { pen = Typeface.DEFAULT; }
        }
        return pen;
    }

    @Nullable private static Bitmap loadArt(String albumKey) {
        if (albumKey == null || albumKey.isEmpty()) return null;
        try {
            File f = App.get().art.get(albumKey, 640);
            return f == null ? null : BitmapFactory.decodeFile(f.getPath());
        } catch (Exception e) { return null; }
    }
}
