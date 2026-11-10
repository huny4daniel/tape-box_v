package io.github.huny4daniel.musiccollection;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * 내장 서버. 폰 안의 화면(WebView)은 127.0.0.1로, 같은 Wi-Fi의 PC 브라우저는 폰의 IP로 접속한다.
 * 폰 밖에서 오는 요청은 「PC에서 접속」을 켰을 때만, 그리고 PIN으로 짝을 맺은 브라우저만 받는다.
 */
public class WebServer extends NanoHTTPD {
    private static final String TAG = "WebServer";
    // 디버그 빌드는 릴리즈 앱과 함께 깔려 있어도 서로의 서버에 붙지 않도록 다른 포트를 쓴다
    public static final int PORT = BuildConfig.DEBUG ? 8643 : 8642;
    private static final String JSON = "application/json; charset=utf-8";
    private static final String COOKIE = "mc_token";

    private final Context ctx;
    private final App app;
    private volatile boolean remoteEnabled = false;
    private int failCount = 0;
    private long lockedUntil = 0;

    public WebServer(App app) {
        super(PORT);
        this.app = app;
        this.ctx = app.getApplicationContext();
    }

    public void setRemoteEnabled(boolean on) { remoteEnabled = on; }
    public boolean isRemoteEnabled() { return remoteEnabled; }

    // ───── 짝 맺기 ─────
    public String pin() {
        String p = app.db.get("pin", null);
        if (p == null) {
            p = String.format(Locale.ROOT, "%06d", new SecureRandom().nextInt(1_000_000));
            app.db.put("pin", p);
        }
        return p;
    }

    private List<String> tokens() {
        List<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(app.db.get("tokens", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (Exception ignored) {}
        return out;
    }

    private String newToken() {
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        List<String> t = tokens();
        t.add(sb.toString());
        while (t.size() > 20) t.remove(0);
        app.db.put("tokens", new JSONArray(t).toString());
        return sb.toString();
    }

    private static boolean isLocal(IHTTPSession s) {
        String ip = s.getRemoteIpAddress();
        return ip != null && (ip.equals("127.0.0.1") || ip.equals("::1") || ip.equals("0:0:0:0:0:0:0:1") || ip.startsWith("::ffff:127."));
    }

    private boolean authorized(IHTTPSession s) {
        if (isLocal(s)) return true;
        String tok = s.getCookies().read(COOKIE);
        return tok != null && tokens().contains(tok);
    }

    /** PC가 접속할 주소들 (Wi-Fi·핫스팟의 IPv4) */
    public static List<String> urls() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName().toLowerCase(Locale.ROOT);
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("dummy") || n.startsWith("tun")) continue; // 모바일 데이터·VPN 제외
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add("http://" + a.getHostAddress() + ":" + PORT);
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    // ───── 요청 처리 ─────
    @Override
    public Response serve(IHTTPSession s) {
        try {
            if (!isLocal(s) && !remoteEnabled) return text(Response.Status.FORBIDDEN, "폰 앱에서 「PC에서 접속」을 켜 주세요.");
            String uri = s.getUri();
            if (!uri.startsWith("/api/")) return asset(uri);
            Response r = api(s, uri);
            r.addHeader("Cache-Control", r.getMimeType() != null && r.getMimeType().startsWith("image/") ? "max-age=604800" : "no-store");
            return r;
        } catch (Exception e) {
            Log.e(TAG, "serve", e);
            return json(Response.Status.INTERNAL_ERROR, "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
        }
    }

    private Response api(IHTTPSession s, String uri) throws Exception {
        Method m = s.getMethod();
        if (uri.equals("/api/status")) {
            JSONObject o = new JSONObject();
            o.put("authorized", authorized(s));
            o.put("scanned", app.library.isScanned());
            o.put("count", app.library.size());
            return json(Response.Status.OK, o.toString());
        }
        if (uri.equals("/api/pair") && m == Method.POST) return pair(s);
        if (!authorized(s)) return json(Response.Status.UNAUTHORIZED, "{\"error\":\"unauthorized\"}");

        String[] parts = uri.substring(5).split("/", 2); // "library", "art/123" …
        String head = parts[0], arg = parts.length > 1 ? parts[1] : null;
        switch (head) {
            case "library":
                return json(Response.Status.OK, app.library.libraryJson());
            case "art": {
                String q = first(s, "s");
                File f = app.art.get(arg, q == null ? 300 : Integer.parseInt(q));
                if (f == null) return json(Response.Status.NOT_FOUND, "{\"error\":\"no art\"}");
                return newFixedLengthResponse(Response.Status.OK, "image/jpeg", new FileInputStream(f), f.length());
            }
            case "stream":
                return stream(s, arg);
            case "lyrics": {
                if (arg == null) { // 만든 시간 가사를 모두 지운다 (PC 생성기의 결과 초기화)
                    if (m != Method.DELETE) break;
                    app.db.clearLyrics(); app.library.forgetAllLyrics();
                    return ok();
                }
                if (m == Method.PUT) { // PC가 음원에 맞춰 만든 시간 가사를 저장한다
                    if (app.library.get(arg) == null) return json(Response.Status.NOT_FOUND, "{\"error\":\"no track\"}");
                    JSONObject b = body(s);
                    String lrc = b.optString("lrc", "");
                    List<Id3Lyrics.Line> lines = Id3Lyrics.parseLrc(lrc);
                    if (lines == null || lines.isEmpty()) return json(Response.Status.BAD_REQUEST, "{\"error\":\"not lrc\"}");
                    app.db.setLyrics(arg, lrc, b.optString("source", "made"));
                    app.library.forgetLyrics(arg);
                    return ok();
                }
                if (m == Method.DELETE) { app.db.deleteLyrics(arg); app.library.forgetLyrics(arg); return ok(); }
                return json(Response.Status.OK, app.library.lyrics(arg).toString());
            }
            case "token": { // PC 프로그램의 가사 생성기가 쓸 토큰. 짝 맺은 창의 토큰을 그대로 돌려줘 토큰이 늘지 않게 한다
                if (m != Method.POST) break;
                String tok = isLocal(s) ? null : s.getCookies().read(COOKIE);
                if (tok == null) tok = newToken();
                return json(Response.Status.OK, new JSONObject().put("token", tok).toString());
            }
            case "plays": {
                JSONObject b = body(s);
                String id = b.getString("id");
                app.db.recordPlay(id, b.optLong("listenedMs", 0), b.optBoolean("counted", false));
                return ok();
            }
            case "track": {
                JSONObject b = body(s);
                if (b.has("fav")) app.db.setFav(arg, b.getBoolean("fav"));
                if (b.has("memo")) app.db.setMemo(arg, b.isNull("memo") ? null : b.getString("memo"));
                return ok();
            }
            case "playlists": {
                if (arg == null && m == Method.GET) return json(Response.Status.OK, app.db.playlists().toString());
                if (arg == null && m == Method.POST) {
                    JSONObject b = body(s);
                    return json(Response.Status.OK, app.db.createPlaylist(b.optString("name", "새 재생목록"), b.optJSONArray("items")).toString());
                }
                if (arg != null && m == Method.PUT) {
                    JSONObject p = app.db.updatePlaylist(arg, body(s));
                    return p == null ? json(Response.Status.NOT_FOUND, "{\"error\":\"not found\"}") : json(Response.Status.OK, p.toString());
                }
                if (arg != null && m == Method.DELETE) { app.db.deletePlaylist(arg); return ok(); }
                break;
            }
            case "rescan":
                app.rescan(null);
                return ok();
            case "folders": {
                if (m == Method.GET) return json(Response.Status.OK, app.library.foldersJson());
                if (m == Method.PUT) {
                    JSONObject b = body(s);
                    JSONArray a = b.optJSONArray("off");
                    List<String> off = new ArrayList<>();
                    if (a != null) for (int i = 0; i < a.length(); i++) off.add(a.getString(i));
                    app.library.setFolders(off, b.optBoolean("autoNew", true)); // 다 읽은 뒤에 답한다
                    app.emit("{\"type\":\"library\"}");
                    return ok();
                }
                break;
            }
        }
        return json(Response.Status.NOT_FOUND, "{\"error\":\"not found\"}");
    }

    private synchronized Response pair(IHTTPSession s) throws Exception {
        long now = System.currentTimeMillis();
        if (now < lockedUntil) return json(Response.Status.FORBIDDEN, "{\"error\":\"locked\"}");
        String pin = body(s).optString("pin", "");
        if (!pin.equals(pin())) {
            if (++failCount >= 5) { failCount = 0; lockedUntil = now + 60_000; }
            return json(Response.Status.FORBIDDEN, "{\"error\":\"wrong pin\"}");
        }
        failCount = 0;
        Response r = ok();
        r.addHeader("Set-Cookie", COOKIE + "=" + newToken() + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax");
        return r;
    }

    /** 곡 파일 보내기. 브라우저가 탐색할 수 있게 Range 요청을 받는다. */
    private Response stream(IHTTPSession s, String id) throws Exception {
        Track t = app.library.get(id);
        if (t == null) return json(Response.Status.NOT_FOUND, "{\"error\":\"no track\"}");
        ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(t.uri(), "r");
        if (pfd == null) return json(Response.Status.NOT_FOUND, "{\"error\":\"cannot open\"}");
        long len = pfd.getStatSize();
        FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
        String range = s.getHeaders().get("range");
        Response r;
        if (range != null && range.startsWith("bytes=")) {
            String[] se = range.substring(6).split(",")[0].split("-", 2);
            long start, end;
            if (se[0].isEmpty()) { start = Math.max(0, len - Long.parseLong(se[1])); end = len - 1; }
            else { start = Long.parseLong(se[0]); end = se.length > 1 && !se[1].isEmpty() ? Math.min(len - 1, Long.parseLong(se[1])) : len - 1; }
            if (start >= len || start > end) {
                in.close();
                r = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, t.mime, "");
                r.addHeader("Content-Range", "bytes */" + len);
                return r;
            }
            in.getChannel().position(start);
            r = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, t.mime, in, end - start + 1);
            r.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + len);
        } else {
            r = newFixedLengthResponse(Response.Status.OK, t.mime, in, len);
        }
        r.addHeader("Accept-Ranges", "bytes");
        r.setGzipEncoding(false);
        return r;
    }

    // ───── 화면 파일 (assets/www) ─────
    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("js", "text/javascript; charset=utf-8");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("json", JSON);
    }

    private Response asset(String uri) {
        if (uri.equals("/") || uri.isEmpty()) uri = "/index.html";
        if (uri.contains("..")) return text(Response.Status.FORBIDDEN, "no");
        AssetManager am = ctx.getAssets();
        try (InputStream in = am.open("www" + uri)) {
            byte[] data = readAll(in);
            String ext = uri.substring(uri.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            Response r = newFixedLengthResponse(Response.Status.OK, TYPES.getOrDefault(ext, "application/octet-stream"), new ByteArrayInputStream(data), data.length);
            r.addHeader("Cache-Control", "no-cache");
            return r;
        } catch (Exception e) {
            return text(Response.Status.NOT_FOUND, "없는 파일이에요");
        }
    }

    // ───── 도구 ─────
    private static String first(IHTTPSession s, String k) {
        List<String> v = s.getParameters().get(k);
        return v == null || v.isEmpty() ? null : v.get(0);
    }

    private static JSONObject body(IHTTPSession s) throws Exception {
        String cl = s.getHeaders().get("content-length");
        int len = cl == null ? 0 : Integer.parseInt(cl.trim());
        if (len <= 0) return new JSONObject();
        if (len > 4 * 1024 * 1024) throw new IllegalArgumentException("body too large");
        byte[] b = new byte[len];
        new DataInputStream(s.getInputStream()).readFully(b);
        return new JSONObject(new String(b, StandardCharsets.UTF_8));
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        return o.toByteArray();
    }

    private static Response json(Response.IStatus st, String body) {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        return newFixedLengthResponse(st, JSON, new ByteArrayInputStream(b), b.length);
    }

    private static Response ok() { return json(Response.Status.OK, "{\"ok\":true}"); }

    private static Response text(Response.IStatus st, String body) {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        return newFixedLengthResponse(st, "text/plain; charset=utf-8", new ByteArrayInputStream(b), b.length);
    }
}
