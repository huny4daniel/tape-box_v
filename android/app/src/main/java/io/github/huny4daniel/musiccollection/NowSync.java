package io.github.huny4daniel.musiccollection;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;

/**
 * PC·폰 재생 동기화. 소리를 내는 기기(owner)는 늘 하나이고, 나머지 기기는 그 상태를 비춰 보며 조작만 보낸다.
 *  - 재생을 누른 기기가 소리를 맡는다 (claim). 앞서 맡던 기기는 조용히 멈춘다
 *  - 소리를 내는 기기는 바뀐 상태를 알린다 (publish). 폰은 재생 서비스가 직접 알려 화면이 꺼져 있어도 이어진다
 *  - 다른 기기의 멈춤·탐색·다음 곡 등은 소리를 내는 기기로 넘긴다 (command). 폰이면 재생 서비스가 바로, PC면 PC가 받아 간다
 *  - 상태가 바뀔 때마다 ver가 오르고, 기다리던 요청(롱 폴링)이 바로 답을 받는다
 */
public class NowSync {
    public static final String PHONE = "phone";
    private static final long STALE_MS = 30_000; // 재생 중이라던 PC가 이만큼 소식이 없으면 멈춘 것으로 본다 (창을 닫았을 때 등)

    private String owner = "";
    private JSONArray ids = new JSONArray();
    private int index = -1;
    private long pos = 0, at = 0, dur = 0, lastSeen = 0;
    private boolean playing = false;
    private String repeat = "off";
    // 화면이 쓰는 덧붙임 정보: 어디서 틀었는지, 셔플과 원래 순서
    private Object ctx = JSONObject.NULL, orig = JSONObject.NULL;
    private boolean shuffle = false;
    private String metaBy = "";
    private long metaVer = 0;
    private long ver = 0, cmdSeq = 0;
    private final ArrayDeque<JSONObject> cmds = new ArrayDeque<>(); // PC가 소리를 낼 때 받아 갈 조작

    private static long now() { return System.currentTimeMillis(); }

    private long posAt(long t) {
        long p = playing ? pos + Math.max(0, t - at) : pos;
        return dur > 0 ? Math.min(p, dur) : p;
    }

    private void freeze() { pos = posAt(now()); at = now(); }

    private void expire() {
        if (playing && !PHONE.equals(owner) && now() - lastSeen > STALE_MS) {
            pos = posAt(lastSeen); at = now(); playing = false; ver++;
        }
    }

    private void bump() { ver++; notifyAll(); }

    public synchronized JSONObject snapshot() throws JSONException {
        expire();
        JSONArray c = new JSONArray();
        for (JSONObject x : cmds) c.put(x);
        return new JSONObject().put("ver", ver).put("owner", owner).put("ids", ids).put("index", index).put("pos", posAt(now()))
                .put("playing", playing).put("dur", dur).put("repeat", repeat)
                .put("ctx", ctx).put("shuffle", shuffle).put("orig", orig).put("metaBy", metaBy).put("metaVer", metaVer)
                .put("cmdSeq", cmdSeq).put("cmds", c);
    }

    /** since보다 새 상태가 생기면 바로, 아니면 ms만큼 기다렸다가 지금 상태를 준다 */
    public synchronized JSONObject await(long since, long ms) throws JSONException {
        long end = now() + ms;
        while (ver <= since) {
            long left = end - now();
            if (left <= 0) break;
            try { wait(left); } catch (InterruptedException e) { break; }
        }
        return snapshot();
    }

    private void take(JSONObject b) {
        if (b.has("ids") && b.optJSONArray("ids") != null) ids = b.optJSONArray("ids");
        if (b.has("index")) index = b.optInt("index", index);
        if (b.has("pos")) { pos = Math.max(0, b.optLong("pos", 0)); at = now(); }
        if (b.has("playing")) playing = b.optBoolean("playing", playing);
        if (b.has("dur")) dur = Math.max(0, b.optLong("dur", 0));
        if (b.has("repeat")) repeat = b.optString("repeat", repeat);
    }

    private void meta(String dev, JSONObject m) {
        Object c = m.opt("ctx"), o = m.opt("orig");
        ctx = c == null ? JSONObject.NULL : c;
        orig = o == null ? JSONObject.NULL : o;
        shuffle = m.optBoolean("shuffle", false);
        metaBy = dev; metaVer++;
    }

    /** 소리를 내는 기기가 알리는 상태. 다른 기기의 것은 받지 않는다 (아무도 맡지 않았으면 폰이 맡는다) */
    public synchronized boolean publish(String dev, JSONObject b) {
        if (owner.isEmpty() && PHONE.equals(dev)) owner = PHONE;
        if (!owner.equals(dev)) return false;
        lastSeen = now();
        take(b);
        JSONObject m = b.optJSONObject("meta");
        if (m != null) meta(dev, m);
        bump();
        return true;
    }

    public synchronized boolean isOwner(String dev) { return owner.equals(dev); }

    /** 이 기기에서 재생을 눌렀다: 소리를 이 기기가 맡는다. 앞서 맡던 기기가 폰이면 폰 소리를 바로 멈춘다 */
    public void claim(String dev, JSONObject b) {
        String prev;
        synchronized (this) {
            prev = owner;
            if (!dev.equals(owner)) { freeze(); playing = false; cmds.clear(); }
            owner = dev;
            lastSeen = now();
            if (b != null) {
                take(b);
                JSONObject m = b.optJSONObject("meta");
                if (m != null) meta(dev, m);
            }
            bump();
        }
        if (PHONE.equals(prev) && !PHONE.equals(dev)) {
            try { PlaybackService.remote(new JSONObject().put("cmd", "pause")); } catch (JSONException ignored) {}
        }
    }

    /** 소리를 내지 않는 기기의 조작. 화면에 바로 보이도록 상태에도 미리 반영한다 */
    public void command(String dev, JSONObject c) throws JSONException {
        String o;
        synchronized (this) {
            o = owner;
            if (o.isEmpty() || o.equals(dev)) return;
            JSONObject m = c.optJSONObject("meta");
            if (m != null) meta(dev, m);
            switch (c.optString("cmd")) {
                case "pause": freeze(); playing = false; break;
                case "seek": pos = Math.max(0, c.optLong("ms", 0)); at = now(); break;
                case "repeat": repeat = c.optString("m", repeat); break;
                case "sync": if (c.optJSONArray("ids") != null) { ids = c.optJSONArray("ids"); index = c.optInt("index", index); } break;
                case "load":
                    if (c.optJSONArray("ids") != null) { ids = c.optJSONArray("ids"); index = c.optInt("index", 0); }
                    pos = Math.max(0, c.optLong("pos", 0)); at = now(); playing = c.optBoolean("autoplay", false);
                    break;
                default: break;
            }
            if (!PHONE.equals(o)) {
                c.put("seq", ++cmdSeq);
                cmds.addLast(c);
                while (cmds.size() > 30) cmds.removeFirst();
            }
            bump();
        }
        if (PHONE.equals(o)) PlaybackService.remote(c);
    }
}
