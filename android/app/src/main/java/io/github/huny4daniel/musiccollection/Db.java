package io.github.huny4daniel.musiccollection;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 폰에 남는 모든 기록: 곡별 수집 번호·재생 기록·아끼는 곡·메모, 재생목록, 설정.
 * 곡 기록은 곡 키로 저장하므로 파일을 옮기거나 지웠다 다시 넣어도 이어진다.
 * 컬렉션에서 빠진 곡의 기록도 지우지 않는다 (수집 번호는 다시 쓰지 않음).
 */
public class Db extends SQLiteOpenHelper {
    public static class Meta {
        public int no, plays;
        public long addedAt, firstPlayed, lastPlayed, listenedMs, favAt;
        public boolean fav;
        public String memo;
    }

    public Db(Context c) { super(c, "collection.db", null, 6); }

    @Override public void onConfigure(SQLiteDatabase db) { db.enableWriteAheadLogging(); }

    // 디버그 빌드: 개발 중 이전 커밋으로 돌아가 DB 버전이 낮아져도 그대로 연다 (스키마 추가분은 CREATE IF NOT EXISTS라 다시 올려도 안전)
    @Override public void onDowngrade(SQLiteDatabase db, int o, int n) {
        if (!BuildConfig.DEBUG) super.onDowngrade(db, o, n);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, no INTEGER NOT NULL, added_at INTEGER, plays INTEGER DEFAULT 0," +
                " first_played INTEGER DEFAULT 0, last_played INTEGER DEFAULT 0, listened_ms INTEGER DEFAULT 0," +
                " fav INTEGER DEFAULT 0, fav_at INTEGER DEFAULT 0, memo TEXT)");
        db.execSQL("CREATE UNIQUE INDEX meta_no ON meta(no)");
        db.execSQL("CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, descr TEXT, created INTEGER, updated INTEGER, items TEXT, cover TEXT)");
        db.execSQL("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)");
        createLyrics(db);
        createRejected(db);
        createBoxes(db);
        createMonthPlays(db);
    }

    @Override public void onUpgrade(SQLiteDatabase db, int o, int n) {
        if (o < 2) createLyrics(db);
        else if (o < 3) db.execSQL("ALTER TABLE lyrics ADD COLUMN chk INTEGER DEFAULT 0");
        if (o < 3) createRejected(db);
        if (o < 4) createBoxes(db);
        if (o < 5) createMonthPlays(db);
        if (o < 6) addColumn(db, "playlists", "cover", "TEXT"); // 테이프 꾸미기 (대표 배경)
    }

    /** 칸이 없을 때만 더한다 (디버그 빌드에서 버전을 내렸다 다시 올려도 안전하게) */
    private static void addColumn(SQLiteDatabase db, String table, String col, String type) {
        try (Cursor c = db.rawQuery("PRAGMA table_info(" + table + ")", null)) {
            while (c.moveToNext()) if (col.equals(c.getString(1))) return;
        }
        db.execSQL("ALTER TABLE " + table + " ADD COLUMN " + col + " " + type);
    }

    /** 히스토리 상자: 달마다(yyyy-MM) 곡별로 「한 번 들었다」로 센 횟수. 그 달에 가장 많이 들은 30곡을 만든다 */
    private static void createMonthPlays(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS month_plays (month TEXT NOT NULL, key TEXT NOT NULL, plays INTEGER DEFAULT 0, last INTEGER DEFAULT 0, PRIMARY KEY (month, key))");
    }

    private static String monthOf(long t) {
        java.util.Calendar c = java.util.Calendar.getInstance(); c.setTimeInMillis(t);
        return String.format(java.util.Locale.ROOT, "%04d-%02d", c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1);
    }

    /** 달마다 가장 많이 들은 곡 (최근 달부터). [{month:"2026-11", items:[곡 키…]}] */
    public synchronized JSONArray monthlyTop(int limit) throws JSONException {
        JSONArray out = new JSONArray();
        java.util.LinkedHashMap<String, JSONArray> by = new java.util.LinkedHashMap<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT month, key FROM month_plays ORDER BY month DESC, plays DESC, last DESC", null)) {
            while (c.moveToNext()) {
                JSONArray a = by.get(c.getString(0));
                if (a == null) { a = new JSONArray(); by.put(c.getString(0), a); }
                if (a.length() < limit) a.put(c.getString(1));
            }
        }
        for (java.util.Map.Entry<String, JSONArray> e : by.entrySet()) out.put(new JSONObject().put("month", e.getKey()).put("items", e.getValue()));
        return out;
    }

    /** PC가 음원에 맞춰 만들어 보낸 시간 가사(LRC). 파일 태그보다 먼저 쓴다 */
    private static void createLyrics(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS lyrics (key TEXT PRIMARY KEY, lrc TEXT NOT NULL, source TEXT, updated INTEGER, chk INTEGER DEFAULT 0)");
    }

    /** 듣다가 되돌린 곡. PC 생성기가 연결될 때 받아 가서 다시 만들거나 되살리지 않게 한다 */
    private static void createRejected(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS lyrics_rejected (key TEXT PRIMARY KEY, at INTEGER)");
    }

    /** 테이프 상자: 재생목록 id를 담아 두는 묶음. 테이프 하나는 상자 하나에만 들어간다 (createBox·updateBox가 지킨다) */
    private static void createBoxes(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS boxes (id TEXT PRIMARY KEY, name TEXT, created INTEGER, updated INTEGER, items TEXT)");
    }

    // ───── 곡 기록 ─────
    public synchronized Map<String, Meta> allMeta() {
        Map<String, Meta> out = new HashMap<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key,no,added_at,plays,first_played,last_played,listened_ms,fav,fav_at,memo FROM meta", null)) {
            while (c.moveToNext()) {
                Meta m = new Meta();
                m.no = c.getInt(1); m.addedAt = c.getLong(2); m.plays = c.getInt(3);
                m.firstPlayed = c.getLong(4); m.lastPlayed = c.getLong(5); m.listenedMs = c.getLong(6);
                m.fav = c.getInt(7) != 0; m.favAt = c.getLong(8); m.memo = c.getString(9);
                out.put(c.getString(0), m);
            }
        }
        return out;
    }

    /** 처음 보는 곡에 다음 수집 번호를 붙인다. tracks는 수집한 순서(addedAt)대로 정렬해서 넘긴다. */
    public synchronized void assignNumbers(List<Track> tracks) {
        if (tracks.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            int no = 0;
            try (Cursor c = db.rawQuery("SELECT IFNULL(MAX(no),0) FROM meta", null)) { if (c.moveToFirst()) no = c.getInt(0); }
            for (Track t : tracks) {
                ContentValues v = new ContentValues();
                v.put("key", t.id); v.put("no", ++no); v.put("added_at", t.addedAt);
                db.insertWithOnConflict("meta", null, v, SQLiteDatabase.CONFLICT_IGNORE);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    public synchronized void recordPlay(String key, long listenedMs, boolean counted) {
        long now = System.currentTimeMillis();
        getWritableDatabase().execSQL(
                "UPDATE meta SET listened_ms = listened_ms + ?, plays = plays + ?," +
                        " last_played = CASE WHEN ? = 1 THEN ? ELSE last_played END," +
                        " first_played = CASE WHEN ? = 1 AND IFNULL(first_played,0) = 0 THEN ? ELSE first_played END WHERE key = ?",
                new Object[]{Math.max(0, listenedMs), counted ? 1 : 0, counted ? 1 : 0, now, counted ? 1 : 0, now, key});
        if (counted) { // ON CONFLICT … DO UPDATE(UPSERT)는 SQLite 3.24부터라 Android 10(3.22)에서는 안 된다 → 두 번에 나눠
            SQLiteDatabase db = getWritableDatabase();
            String month = monthOf(now);
            db.execSQL("INSERT OR IGNORE INTO month_plays (month, key, plays, last) VALUES (?, ?, 0, ?)", new Object[]{month, key, now});
            db.execSQL("UPDATE month_plays SET plays = plays + 1, last = ? WHERE month = ? AND key = ?", new Object[]{now, month, key});
        }
    }

    /** 설정 → 기록 초기화: 고른 것만 지운다 (수집 번호·메모·테이프·상자는 그대로) */
    public synchronized void resetRecords(boolean plays, boolean favs, boolean history) {
        ContentValues v = new ContentValues();
        if (plays) { v.put("plays", 0); v.put("listened_ms", 0); }
        if (favs) { v.put("fav", 0); v.put("fav_at", 0); }
        if (history) { v.put("first_played", 0); v.put("last_played", 0); }
        if (v.size() > 0) getWritableDatabase().update("meta", v, null, null);
        if (plays) getWritableDatabase().delete("month_plays", null, null); // 히스토리 상자도 들은 횟수에서 나온다
        if (history) { try { mergePrefs(new JSONObject().put("tapePlayed", JSONObject.NULL)); } catch (JSONException ignored) {} } // 최근 들은 테이프
    }

    public synchronized void setFav(String key, boolean fav) {
        ContentValues v = new ContentValues();
        v.put("fav", fav ? 1 : 0); v.put("fav_at", fav ? System.currentTimeMillis() : 0);
        getWritableDatabase().update("meta", v, "key = ?", new String[]{key});
    }

    public synchronized void setMemo(String key, String memo) {
        ContentValues v = new ContentValues();
        v.put("memo", memo);
        getWritableDatabase().update("meta", v, "key = ?", new String[]{key});
    }

    // ───── 재생목록 ─────
    private static JSONObject plRow(Cursor c) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", c.getString(0)); o.put("name", c.getString(1)); o.put("desc", c.getString(2) == null ? "" : c.getString(2));
        o.put("created", c.getLong(3)); o.put("updated", c.getLong(4));
        o.put("items", new JSONArray(c.getString(5) == null ? "[]" : c.getString(5)));
        o.put("cover", c.getString(6) == null ? "" : c.getString(6));
        return o;
    }

    public synchronized JSONArray playlists() throws JSONException {
        JSONArray a = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,descr,created,updated,items,cover FROM playlists ORDER BY created", null)) {
            while (c.moveToNext()) a.put(plRow(c));
        }
        return a;
    }

    public synchronized JSONObject playlist(String id) throws JSONException {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,descr,created,updated,items,cover FROM playlists WHERE id = ?", new String[]{id})) {
            return c.moveToFirst() ? plRow(c) : null;
        }
    }

    public synchronized JSONObject createPlaylist(String name, JSONArray items) throws JSONException {
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        long now = System.currentTimeMillis();
        ContentValues v = new ContentValues();
        v.put("id", id); v.put("name", name); v.put("descr", ""); v.put("created", now); v.put("updated", now);
        v.put("items", (items == null ? new JSONArray() : items).toString());
        getWritableDatabase().insert("playlists", null, v);
        return playlist(id);
    }

    public synchronized JSONObject updatePlaylist(String id, JSONObject patch) throws JSONException {
        ContentValues v = new ContentValues();
        if (patch.has("name")) v.put("name", patch.getString("name"));
        if (patch.has("desc")) v.put("descr", patch.getString("desc"));
        if (patch.has("items")) v.put("items", patch.getJSONArray("items").toString());
        if (patch.has("cover")) v.put("cover", patch.getString("cover"));
        v.put("updated", System.currentTimeMillis());
        getWritableDatabase().update("playlists", v, "id = ?", new String[]{id});
        return playlist(id);
    }

    public synchronized void deletePlaylist(String id) {
        getWritableDatabase().delete("playlists", "id = ?", new String[]{id});
        try { takeOutOfBoxes(java.util.Collections.singleton(id), null); } catch (JSONException ignored) {} // 지운 테이프는 상자에서도 뺀다
    }

    /**
     * (디버그 빌드) 원래 앱의 곡 기록·재생목록으로 통째로 바꾼다. tracks는 /api/library 의 tracks, playlists는 /api/playlists 모양.
     * 수집 번호까지 그대로 옮기고, 원래 앱에 없던 곡은 다음 스캔 때 뒤에 번호를 받는다.
     */
    /** (디버그 빌드) 원래 앱의 곡 기록·테이프·상자로 바꾼다. boxes가 null이면(상자 기능이 없는 옛 원래 앱) 상자는 그대로 둔다 */
    public synchronized void replaceFromRelease(JSONArray tracks, JSONArray playlists, JSONArray boxes) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("meta", null, null);
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject t = tracks.getJSONObject(i);
                if (t.optInt("n", 0) <= 0) continue;
                ContentValues v = new ContentValues();
                v.put("key", t.getString("id")); v.put("no", t.getInt("n")); v.put("added_at", t.optLong("addedAt", 0));
                v.put("plays", t.optInt("plays", 0)); v.put("first_played", t.optLong("firstPlayed", 0)); v.put("last_played", t.optLong("lastPlayed", 0));
                v.put("listened_ms", t.optLong("listenedMs", 0)); v.put("fav", t.optBoolean("fav", false) ? 1 : 0); v.put("fav_at", t.optLong("favAt", 0));
                String memo = t.optString("memo", "");
                if (!memo.isEmpty()) v.put("memo", memo);
                db.insertWithOnConflict("meta", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.delete("playlists", null, null);
            for (int i = 0; i < playlists.length(); i++) {
                JSONObject p = playlists.getJSONObject(i);
                ContentValues v = new ContentValues();
                v.put("id", p.getString("id")); v.put("name", p.optString("name", "")); v.put("descr", p.optString("desc", ""));
                v.put("created", p.optLong("created", 0)); v.put("updated", p.optLong("updated", 0));
                v.put("items", p.optJSONArray("items") == null ? "[]" : p.getJSONArray("items").toString());
                v.put("cover", p.optString("cover", ""));
                db.insertWithOnConflict("playlists", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            if (boxes != null) { // 상자는 테이프 id로 묶여 있고, 테이프 id를 그대로 가져왔으니 그대로 맞는다
                db.delete("boxes", null, null);
                for (int i = 0; i < boxes.length(); i++) {
                    JSONObject b = boxes.getJSONObject(i);
                    ContentValues v = new ContentValues();
                    v.put("id", b.getString("id")); v.put("name", b.optString("name", ""));
                    v.put("created", b.optLong("created", 0)); v.put("updated", b.optLong("updated", 0));
                    v.put("items", b.optJSONArray("items") == null ? "[]" : b.getJSONArray("items").toString());
                    db.insertWithOnConflict("boxes", null, v, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    // ───── 테이프 상자 ─────
    private static JSONObject boxRow(Cursor c) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", c.getString(0)); o.put("name", c.getString(1));
        o.put("created", c.getLong(2)); o.put("updated", c.getLong(3));
        o.put("items", new JSONArray(c.getString(4) == null ? "[]" : c.getString(4)));
        return o;
    }

    public synchronized JSONArray boxes() throws JSONException {
        JSONArray a = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,created,updated,items FROM boxes ORDER BY created", null)) {
            while (c.moveToNext()) a.put(boxRow(c));
        }
        return a;
    }

    public synchronized JSONObject box(String id) throws JSONException {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,created,updated,items FROM boxes WHERE id = ?", new String[]{id})) {
            return c.moveToFirst() ? boxRow(c) : null;
        }
    }

    /*
     * 상자 규칙 (화면이 어떻게 보내든 여기서 지킨다)
     *  - 상자에는 내가 만든 테이프(playlists 표에 있는 것)만 들어간다. 시스템·히스토리·임의 테이프, 지운 테이프 id는 버린다
     *  - 한 테이프는 한 상자에만 들어간다. 어떤 상자에 넣으면 다른 상자에서는 빠진다
     */
    private java.util.LinkedHashSet<String> boxableIds(JSONArray items) {
        java.util.LinkedHashSet<String> want = new java.util.LinkedHashSet<>(), ok = new java.util.LinkedHashSet<>();
        if (items != null) for (int i = 0; i < items.length(); i++) { String s = items.optString(i, ""); if (!s.isEmpty()) want.add(s); }
        if (want.isEmpty()) return ok;
        java.util.HashSet<String> mine = new java.util.HashSet<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id FROM playlists", null)) { while (c.moveToNext()) mine.add(c.getString(0)); }
        for (String s : want) if (mine.contains(s)) ok.add(s);
        return ok;
    }

    /** ids를 exceptBox가 아닌 모든 상자에서 뺀다 */
    private void takeOutOfBoxes(java.util.Set<String> ids, String exceptBox) throws JSONException {
        if (ids.isEmpty()) return;
        JSONArray all = boxes();
        for (int i = 0; i < all.length(); i++) {
            JSONObject b = all.getJSONObject(i);
            if (b.getString("id").equals(exceptBox)) continue;
            JSONArray its = b.getJSONArray("items"), keep = new JSONArray();
            for (int k = 0; k < its.length(); k++) if (!ids.contains(its.optString(k))) keep.put(its.get(k));
            if (keep.length() == its.length()) continue;
            ContentValues v = new ContentValues();
            v.put("items", keep.toString()); v.put("updated", System.currentTimeMillis());
            getWritableDatabase().update("boxes", v, "id = ?", new String[]{b.getString("id")});
        }
    }

    public synchronized JSONObject createBox(String name, JSONArray items) throws JSONException {
        String id = "b" + UUID.randomUUID().toString().replace("-", "").substring(0, 11);
        long now = System.currentTimeMillis();
        java.util.LinkedHashSet<String> ids = boxableIds(items);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            takeOutOfBoxes(ids, id);
            ContentValues v = new ContentValues();
            v.put("id", id); v.put("name", name); v.put("created", now); v.put("updated", now);
            v.put("items", new JSONArray(ids).toString());
            db.insert("boxes", null, v);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return box(id);
    }

    public synchronized JSONObject updateBox(String id, JSONObject patch) throws JSONException {
        if (box(id) == null) return null;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues v = new ContentValues();
            if (patch.has("name")) v.put("name", patch.getString("name"));
            if (patch.has("items")) {
                java.util.LinkedHashSet<String> ids = boxableIds(patch.getJSONArray("items"));
                takeOutOfBoxes(ids, id);
                v.put("items", new JSONArray(ids).toString());
            }
            v.put("updated", System.currentTimeMillis());
            db.update("boxes", v, "id = ?", new String[]{id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return box(id);
    }

    public synchronized void deleteBox(String id) {
        getWritableDatabase().delete("boxes", "id = ?", new String[]{id});
    }

    /**
     * 다른 플레이어에서 가져온 재생목록을 맞춘다. 처음 보면 만들고, 이후엔 이 앱에서 고치지 않은 동안만 원본을 따라간다.
     * 이 앱에서 지운 재생목록은 다시 만들지 않는다. 바뀐 게 있으면 true.
     */
    /** 가져온 테이프를 그 이름의 상자에 넣는다 (없으면 만든다). 다른 상자에 있었으면 거기서 빠진다 (createBox·updateBox가 지킨다) */
    public synchronized void putInBoxByName(String plId, String boxName) throws JSONException {
        JSONArray all = boxes();
        JSONObject target = null;
        for (int i = 0; i < all.length() && target == null; i++) if (all.getJSONObject(i).optString("name").equals(boxName)) target = all.getJSONObject(i);
        if (target == null) { createBox(boxName, new JSONArray().put(plId)); return; }
        JSONArray its = target.getJSONArray("items");
        for (int k = 0; k < its.length(); k++) if (plId.equals(its.optString(k))) return;
        its.put(plId);
        updateBox(target.getString("id"), new JSONObject().put("items", its));
    }

    /** 가져온 원본(sourceKey)의 테이프 id, 아직 안 가져왔으면 null */
    public synchronized String importedPlaylistId(String sourceKey) {
        try { String rec = get("import:" + sourceKey, null); return rec == null ? null : new JSONObject(rec).getString("id"); } catch (Exception e) { return null; }
    }

    public synchronized boolean syncImportedPlaylist(String sourceKey, String name, List<String> items) throws JSONException {
        String k = "import:" + sourceKey;
        String rec = get(k, null);
        JSONArray arr = new JSONArray(items);
        if (rec == null) {
            JSONObject pl = createPlaylist(name, arr);
            put(k, new JSONObject().put("id", pl.getString("id")).put("at", pl.getLong("updated")).toString());
            return true;
        }
        JSONObject r = new JSONObject(rec);
        JSONObject pl = playlist(r.getString("id"));
        if (pl == null || pl.getLong("updated") != r.getLong("at")) return false; // 지웠거나 이 앱에서 고친 목록
        if (pl.getString("name").equals(name) && pl.getJSONArray("items").toString().equals(arr.toString())) return false;
        pl = updatePlaylist(pl.getString("id"), new JSONObject().put("name", name).put("items", arr));
        put(k, r.put("at", pl.getLong("updated")).toString());
        return true;
    }

    // ───── 만든 가사 ─────
    /** [lrc, source, chk("1": PC 생성기가 확인 필요로 판정)] 또는 null */
    public synchronized String[] lyrics(String key) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT lrc, source, chk FROM lyrics WHERE key = ?", new String[]{key})) {
            return c.moveToFirst() ? new String[]{c.getString(0), c.getString(1), c.getInt(2) == 1 ? "1" : "0"} : null;
        }
    }

    public synchronized void setLyrics(String key, String lrc, String source, boolean check) {
        ContentValues v = new ContentValues();
        v.put("key", key); v.put("lrc", lrc); v.put("source", source); v.put("updated", System.currentTimeMillis()); v.put("chk", check ? 1 : 0);
        SQLiteDatabase w = getWritableDatabase();
        w.insertWithOnConflict("lyrics", null, v, SQLiteDatabase.CONFLICT_REPLACE);
        w.delete("lyrics_rejected", "key = ?", new String[]{key}); // PC가 다시 만들어 보냈으면 되돌림은 풀린다
    }

    public synchronized void clearLyrics() {
        SQLiteDatabase w = getWritableDatabase();
        w.delete("lyrics", null, null);
        w.delete("lyrics_rejected", null, null);
    }

    /** 만든 가사를 지우고 되돌린 곡으로 남긴다 */
    public synchronized void rejectLyrics(String key) {
        SQLiteDatabase w = getWritableDatabase();
        w.delete("lyrics", "key = ?", new String[]{key});
        ContentValues v = new ContentValues();
        v.put("key", key); v.put("at", System.currentTimeMillis());
        w.insertWithOnConflict("lyrics_rejected", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** [{id, at(ms)}] */
    public synchronized JSONArray rejectedLyrics() throws JSONException {
        JSONArray out = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key, at FROM lyrics_rejected", null)) {
            while (c.moveToNext()) out.put(new JSONObject().put("id", c.getString(0)).put("at", c.getLong(1)));
        }
        return out;
    }

    public synchronized void deleteLyrics(String key) {
        getWritableDatabase().delete("lyrics", "key = ?", new String[]{key});
    }

    // ───── 화면 상태 (기기를 가리지 않는 것: js/prefs.js) ─────
    public synchronized JSONObject prefs() {
        try { return new JSONObject(get("ui_prefs", "{}")); } catch (JSONException e) { return new JSONObject(); }
    }

    /** 바뀐 부분만 합친다: null이면 지우고, 객체끼리는 한 단계 아래까지 합친다(그 안의 null도 지움), 나머지는 바꾼다 */
    public synchronized JSONObject mergePrefs(JSONObject patch) throws JSONException {
        JSONObject cur = prefs();
        java.util.Iterator<String> it = patch.keys();
        while (it.hasNext()) {
            String k = it.next();
            Object v = patch.get(k);
            if (v == JSONObject.NULL) { cur.remove(k); continue; }
            JSONObject old = cur.optJSONObject(k);
            if (v instanceof JSONObject && old != null) {
                JSONObject pv = (JSONObject) v;
                java.util.Iterator<String> it2 = pv.keys();
                while (it2.hasNext()) { String kk = it2.next(); Object vv = pv.get(kk); if (vv == JSONObject.NULL) old.remove(kk); else old.put(kk, vv); }
            } else cur.put(k, v);
        }
        put("ui_prefs", cur.toString());
        return cur;
    }

    // ───── 설정 ─────
    public synchronized String get(String k, String def) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT v FROM kv WHERE k = ?", new String[]{k})) {
            return c.moveToFirst() ? c.getString(0) : def;
        }
    }

    public synchronized void put(String k, String v) {
        ContentValues cv = new ContentValues();
        cv.put("k", k); cv.put("v", v);
        getWritableDatabase().insertWithOnConflict("kv", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }
}
