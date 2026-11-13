package io.github.huny4daniel.musiccollection;

import android.app.Application;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 앱 전체에서 하나씩 쓰는 것들: DB, 라이브러리, 앨범아트, 내장 서버 */
public class App extends Application {
    private static App instance;
    public Db db;
    public Library library;
    public ArtCache art;
    public WebServer server;
    public final NowSync now = new NowSync(); // PC·폰 재생 동기화
    public final ExecutorService io = Executors.newSingleThreadExecutor();
    public final Handler main = new Handler(Looper.getMainLooper());

    /** 재생 서비스가 화면에 알리는 일 (화면이 없으면 null) */
    public interface Events { void onNativeEvent(String json); }
    public volatile Events events;

    public static App get() { return instance; }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        db = new Db(this);
        library = new Library(this, db);
        art = new ArtCache(this, library);
        server = new WebServer(this);
        try {
            server.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false);
        } catch (Exception e) {
            Log.e("App", "server start failed", e);
        }
        if ("1".equals(db.get("remote", "0"))) setRemoteEnabled(true);
    }

    public void emit(String json) {
        Events e = events;
        if (e != null) main.post(() -> e.onNativeEvent(json));
    }

    /** 라이브러리를 다시 읽고, 끝나면 화면에 알린다 */
    public void rescan(Runnable done) {
        io.execute(() -> {
            library.scan();
            PlaylistExport.schedule(this); // 가져온 테이프·곡 경로가 바뀌었을 수 있다
            emit("{\"type\":\"library\"}");
            if (done != null) main.post(done);
        });
    }

    public void setRemoteEnabled(boolean on) {
        db.put("remote", on ? "1" : "0");
        server.setRemoteEnabled(on);
        Intent i = new Intent(this, ServerService.class);
        if (on) {
            try { startForegroundService(i); } catch (Exception e) { Log.w("App", "fgs", e); }
        } else stopService(i);
    }
}
