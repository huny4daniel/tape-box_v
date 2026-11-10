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

    public Db(Context c) { super(c, "collection.db", null, 1); }

    @Override public void onConfigure(SQLiteDatabase db) { db.enableWriteAheadLogging(); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, no INTEGER NOT NULL, added_at INTEGER, plays INTEGER DEFAULT 0," +
                " first_played INTEGER DEFAULT 0, last_played INTEGER DEFAULT 0, listened_ms INTEGER DEFAULT 0," +
                " fav INTEGER DEFAULT 0, fav_at INTEGER DEFAULT 0, memo TEXT)");
        db.execSQL("CREATE UNIQUE INDEX meta_no ON meta(no)");
        db.execSQL("CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, descr TEXT, created INTEGER, updated INTEGER, items TEXT)");
        db.execSQL("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int o, int n) {}

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
        return o;
    }

    public synchronized JSONArray playlists() throws JSONException {
        JSONArray a = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,descr,created,updated,items FROM playlists ORDER BY created", null)) {
            while (c.moveToNext()) a.put(plRow(c));
        }
        return a;
    }

    public synchronized JSONObject playlist(String id) throws JSONException {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,name,descr,created,updated,items FROM playlists WHERE id = ?", new String[]{id})) {
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
        v.put("updated", System.currentTimeMillis());
        getWritableDatabase().update("playlists", v, "id = ?", new String[]{id});
        return playlist(id);
    }

    public synchronized void deletePlaylist(String id) {
        getWritableDatabase().delete("playlists", "id = ?", new String[]{id});
    }

    /**
     * 다른 플레이어에서 가져온 재생목록을 맞춘다. 처음 보면 만들고, 이후엔 이 앱에서 고치지 않은 동안만 원본을 따라간다.
     * 이 앱에서 지운 재생목록은 다시 만들지 않는다. 바뀐 게 있으면 true.
     */
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
