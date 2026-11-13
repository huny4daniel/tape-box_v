package io.github.huny4daniel.musiccollection;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** 웹 화면을 띄우고, 화면의 재생 요청을 Media3 재생 서비스로 넘긴다. */
public class MainActivity extends ComponentActivity {
    private static final int REQ_PERM = 1;
    private WebView web;
    private App app;
    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private final List<Consumer<MediaController>> pending = new ArrayList<>();
    private volatile String stateJson = "{}";
    private boolean loaded = false, resumedOnce = false;
    /** 재생목록 폴더 고르기 (다른 앱이 내보낸 .smpl/.m3u 파일을 읽을 권한을 받는다) */
    private final ActivityResultLauncher<Uri> pickDir = registerForActivityResult(new ActivityResultContracts.OpenDocumentTree(), uri -> {
        if (uri == null) return;
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) { android.util.Log.w("Main", "persist", e); }
        String old = app.db.get(PlaylistImport.K_DIR, "");
        if (!old.isEmpty() && !old.equals(uri.toString())) releaseDir(old);
        app.db.put(PlaylistImport.K_DIR, uri.toString());
        app.rescan(null);
    });

    /** 테이프 저장 폴더 고르기 (내가 만든 테이프를 .m3u8로 저장하고 고칠 권한을 받는다) */
    private final ActivityResultLauncher<Uri> pickExportDir = registerForActivityResult(new ActivityResultContracts.OpenDocumentTree(), uri -> {
        if (uri == null) return;
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) { android.util.Log.w("Main", "persist export", e); }
        String old = app.db.get(PlaylistExport.K_DIR, "");
        if (!old.isEmpty() && !old.equals(uri.toString())) releaseExportDir(old);
        if (!old.equals(uri.toString())) app.db.put(PlaylistExport.K_MAP, "{}"); // 새 폴더에는 처음부터 다시 쓴다 (옛 폴더의 파일은 그대로 둔다)
        app.db.put(PlaylistExport.K_DIR, uri.toString());
        PlaylistExport.saveSoon(app);
        app.emit("{\"type\":\"exportdir\"}");
    });

    private void releaseExportDir(String u) {
        try { getContentResolver().releasePersistableUriPermission(Uri.parse(u), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) {}
    }

    private void releaseDir(String u) {
        try { getContentResolver().releasePersistableUriPermission(Uri.parse(u), Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
    }

    @SuppressLint("SetJavaScriptEnabled")
    /** 화면이 꺼져도 PC 접속이 끊기지 않도록 배터리 최적화에서 빼 달라고 한 번 묻는다 (이미 빠져 있으면 묻지 않음) */
    private void askBatteryExemption() {
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {}
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        app = App.get();
        // 디버그 빌드면 PC 크롬의 chrome://inspect 로 웹 화면을 들여다볼 수 있게
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0D0C0B"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        // WebView 자체의 안쪽 여백은 웹 화면 배치에 반영되지 않아서(상태 표시줄 밑으로 그려짐),
        // 바깥 틀에 여백을 줘 WebView가 시스템 막대를 뺀 자리에만 놓이게 한다
        android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.setBackgroundColor(0xFF0D0C0B);
        frame.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);

        // 시스템 막대만큼 안쪽으로 (targetSdk 35는 화면 끝까지 그린다)
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, Math.max(i.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                web.evaluateJavascript("window.__back ? window.__back() : false", r -> {
                    if (!"true".equals(r)) moveTaskToBack(true);
                });
            }
        });

        app.events = this::sendToWeb;
        connectController();
        if (hasAudioPermission()) startLibrary();
        else {
            List<String> req = new ArrayList<>();
            req.add(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE);
            if (Build.VERSION.SDK_INT >= 33) req.add(Manifest.permission.POST_NOTIFICATIONS);
            requestPermissions(req.toArray(new String[0]), REQ_PERM);
        }
    }

    private boolean hasAudioPermission() {
        String p = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERM) startLibrary(); // 거절해도 화면은 띄운다 (빈 컬렉션 안내)
    }

    private void startLibrary() {
        if (app.library.isScanned()) { loadPage(); app.rescan(null); return; }
        app.rescan(this::loadPage);
    }

    private void loadPage() {
        if (loaded) return;
        loaded = true;
        web.loadUrl("http://127.0.0.1:" + WebServer.PORT + "/");
    }

    @Override protected void onResume() {
        super.onResume();
        if (resumedOnce && loaded) sendToWeb("{\"type\":\"resume\"}");
        resumedOnce = true;
    }

    @Override protected void onDestroy() {
        if (app.events != null) app.events = null;
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        controller = null;
        web.destroy();
        super.onDestroy();
    }

    private void sendToWeb(String json) {
        if (web == null || !loaded) return;
        web.evaluateJavascript("window.__native && window.__native(" + json + ")", null);
    }

    // ───── 재생 서비스 연결 ─────
    private void connectController() {
        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        controllerFuture = new MediaController.Builder(this, token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player p, Player.Events ev) {
                        pushState(ev.contains(Player.EVENT_TIMELINE_CHANGED) || ev.contains(Player.EVENT_MEDIA_ITEM_TRANSITION));
                        if (ev.contains(Player.EVENT_PLAYER_ERROR)) sendToWeb("{\"type\":\"error\"}");
                    }
                });
                pushState(true);
                for (Consumer<MediaController> c : pending) c.accept(controller);
                pending.clear();
            } catch (Exception e) {
                android.util.Log.e("Main", "controller", e);
            }
        }, getMainExecutor());
    }

    private void withController(Consumer<MediaController> fn) {
        runOnUiThread(() -> {
            if (controller != null) fn.accept(controller); else pending.add(fn);
        });
    }

    private void pushState(boolean withIds) {
        MediaController c = controller;
        if (c == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("type", "state");
            o.put("index", c.getMediaItemCount() == 0 ? -1 : c.getCurrentMediaItemIndex());
            int st = c.getPlaybackState();
            o.put("playing", c.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE);
            o.put("pos", c.getCurrentPosition());
            long d = c.getDuration();
            o.put("dur", d == C.TIME_UNSET ? 0 : d);
            int rm = c.getRepeatMode();
            o.put("repeat", rm == Player.REPEAT_MODE_ONE ? "one" : rm == Player.REPEAT_MODE_ALL ? "all" : "off");
            o.put("shuffle", Shuffle.on(MainActivity.this));
            JSONArray ids = new JSONArray();
            for (int i = 0; i < c.getMediaItemCount(); i++) ids.put(c.getMediaItemAt(i).mediaId);
            JSONObject full = new JSONObject(o.toString()).put("ids", ids).put("orig", new JSONArray(Shuffle.orig(MainActivity.this)));
            stateJson = full.toString();
            sendToWeb(withIds ? stateJson : o.toString());
        } catch (Exception ignored) {}
    }

    private static List<MediaItem> items(String idsJson) {
        List<MediaItem> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(idsJson);
            for (int i = 0; i < a.length(); i++) out.add(new MediaItem.Builder().setMediaId(a.getString(i)).build());
        } catch (Exception ignored) {}
        return out;
    }

    /** 웹 화면에서 window.NativeBridge로 부르는 함수들 (자바스크립트 스레드에서 불림) */
    private class Bridge {
        @JavascriptInterface public void setQueue(String idsJson, int index, int posMs, boolean autoplay) {
            List<MediaItem> list = items(idsJson);
            withController(c -> {
                c.setShuffleModeEnabled(false);
                c.setMediaItems(list, index, posMs);
                c.prepare();
                c.setPlayWhenReady(autoplay);
            });
        }

        /** 지금 곡은 그대로 두고 앞뒤 대기열만 바꾼다 (끊김 없이) */
        @JavascriptInterface public void syncQueue(String idsJson, int newIndex) {
            List<MediaItem> list = items(idsJson);
            withController(c -> {
                int cur = c.getCurrentMediaItemIndex(), n = c.getMediaItemCount();
                if (n == 0 || newIndex < 0 || newIndex >= list.size()
                        || !list.get(newIndex).mediaId.equals(c.getMediaItemAt(cur).mediaId)) {
                    long pos = c.getCurrentPosition();
                    c.setMediaItems(list, Math.max(0, newIndex), pos);
                    c.prepare();
                    return;
                }
                if (cur + 1 < n) c.removeMediaItems(cur + 1, n);
                if (cur > 0) c.removeMediaItems(0, cur);
                if (newIndex > 0) c.addMediaItems(0, list.subList(0, newIndex));
                if (newIndex + 1 < list.size()) c.addMediaItems(list.subList(newIndex + 1, list.size()));
            });
        }

        @JavascriptInterface public void jump(int i) { withController(c -> { if (i >= 0 && i < c.getMediaItemCount()) { c.seekTo(i, 0); c.play(); } }); }
        @JavascriptInterface public void play() {
            withController(c -> {
                if (c.getPlaybackState() == Player.STATE_ENDED) c.seekTo(c.getCurrentMediaItemIndex(), 0);
                if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare();
                c.play();
            });
        }
        @JavascriptInterface public void pause() { withController(Player::pause); }
        @JavascriptInterface public void next() { withController(c -> { if (c.hasNextMediaItem()) c.seekToNextMediaItem(); else if (c.getRepeatMode() == Player.REPEAT_MODE_ONE && c.getMediaItemCount() > 0) c.seekTo(0, 0); }); }
        @JavascriptInterface public void prev() { withController(Player::seekToPrevious); }
        @JavascriptInterface public void seek(int ms) { withController(c -> c.seekTo(ms)); }
        @JavascriptInterface public void setRepeat(String m) {
            withController(c -> c.setRepeatMode("one".equals(m) ? Player.REPEAT_MODE_ONE : "all".equals(m) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF));
        }
        @JavascriptInterface public String getState() { return stateJson; }
        /** 홈 화면 위젯 카세트에 적을 테이프 이름 (지금 재생 중인 재생목록) */
        @JavascriptInterface public void setTapeName(String name) { TapeWidget.setTapeName(MainActivity.this, name); }
        /** 화면에서 셔플을 켜고 끌 때 (위젯과 같은 상태를 보도록). 대기열을 바꾸기 전에 불린다 */
        @JavascriptInterface public void setShuffleState(boolean on, String origJson) { Shuffle.set(MainActivity.this, on, origJson); }

        @JavascriptInterface public String getServerInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("enabled", app.server.isRemoteEnabled());
                o.put("urls", new JSONArray(WebServer.urls()));
                o.put("pin", app.server.pin());
                o.put("port", WebServer.PORT);
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public void setServerEnabled(boolean on) {
            runOnUiThread(() -> { app.setRemoteEnabled(on); if (on) askBatteryExemption(); });
        }
        @JavascriptInterface public void rescan() { app.rescan(null); }

        /** 고른 재생목록 폴더의 표시 이름 ("Music/Playlists"), 없으면 "" */
        @JavascriptInterface public String getPlaylistDir() {
            String u = app.db.get(PlaylistImport.K_DIR, "");
            if (u.isEmpty()) return "";
            try {
                String id = DocumentsContract.getTreeDocumentId(Uri.parse(u)); // "primary:Music/Playlists"
                int i = id.indexOf(':');
                String p = i >= 0 ? id.substring(i + 1) : id;
                return p.isEmpty() ? "저장공간 최상위" : p;
            } catch (Exception e) { return "?"; }
        }
        @JavascriptInterface public void pickPlaylistDir() { runOnUiThread(() -> pickDir.launch(null)); }
        /** 테이프 저장 폴더의 표시 이름, 없으면 "" */
        @JavascriptInterface public String getExportDir() {
            String u = app.db.get(PlaylistExport.K_DIR, "");
            if (u.isEmpty()) return "";
            try {
                String id = DocumentsContract.getTreeDocumentId(Uri.parse(u));
                int i = id.indexOf(':');
                String p = i >= 0 ? id.substring(i + 1) : id;
                return p.isEmpty() ? "저장공간 최상위" : p;
            } catch (Exception e) { return "?"; }
        }
        @JavascriptInterface public void pickExportDir() { runOnUiThread(() -> pickExportDir.launch(null)); }
        @JavascriptInterface public void clearExportDir() { // 저장을 멈춘다 (이미 만든 파일은 그대로 남는다)
            String u = app.db.get(PlaylistExport.K_DIR, "");
            if (!u.isEmpty()) { releaseExportDir(u); app.db.put(PlaylistExport.K_DIR, ""); app.db.put(PlaylistExport.K_MAP, "{}"); }
        }
        @JavascriptInterface public void exportNow() { PlaylistExport.saveSoon(app); }
        @JavascriptInterface public boolean getExportAuto() { return PlaylistExport.auto(app.db); }
        @JavascriptInterface public void setExportAuto(boolean on) { app.db.put(PlaylistExport.K_AUTO, on ? "1" : "0"); if (on) PlaylistExport.saveSoon(app); } // 다시 켜면 그동안 바뀐 것을 한 번 맞춘다
        @JavascriptInterface public void clearPlaylistDir() {
            String u = app.db.get(PlaylistImport.K_DIR, "");
            if (!u.isEmpty()) { releaseDir(u); app.db.put(PlaylistImport.K_DIR, ""); }
        }
    }
}
