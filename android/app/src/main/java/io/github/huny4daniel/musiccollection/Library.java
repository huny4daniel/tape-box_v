package io.github.huny4daniel.musiccollection;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Log;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/** 폰의 음악을 MediaStore에서 읽어 곡 목록을 만든다. 화면과 재생기는 모두 여기의 곡 id를 쓴다. */
public class Library {
    private static final String TAG = "Library";
    private final Context ctx;
    private final Db db;
    private volatile List<Track> tracks = Collections.emptyList();
    private volatile Map<String, Track> byId = Collections.emptyMap();
    private volatile Map<String, Track> albumRep = Collections.emptyMap();
    private volatile boolean scanned = false;
    /** 음악이 든 폴더마다 곡 수 (제외한 폴더도 포함) */
    private volatile Map<String, Integer> folderCounts = Collections.emptyMap();
    private final Map<String, JSONObject> lyricsCache = Collections.synchronizedMap(new LinkedHashMap<String, JSONObject>(64, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, JSONObject> e) { return size() > 64; }
    });

    public Library(Context ctx, Db db) { this.ctx = ctx.getApplicationContext(); this.db = db; }

    public boolean isScanned() { return scanned; }
    public int size() { return tracks.size(); }
    public Track get(String id) { return id == null ? null : byId.get(id); }
    public Track albumRep(String albumKey) { return albumRep.get(albumKey); }

    public synchronized void scan() {
        long t0 = System.currentTimeMillis();
        List<String> proj = new ArrayList<>(List.of(
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.DATE_MODIFIED, MediaStore.Audio.Media.MIME_TYPE, MediaStore.Audio.Media.SIZE,
                "album_artist", MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.RELATIVE_PATH));
        boolean hasGenre = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        if (hasGenre) proj.add(MediaStore.Audio.Media.GENRE);

        List<Track> list = new ArrayList<>();
        Map<String, Track> ids = new HashMap<>();
        Map<Long, Track> byMedia = new HashMap<>();
        Map<String, Track> byPath = new HashMap<>();
        Map<String, Integer> folders = new TreeMap<>();
        FolderFilter filter = FolderFilter.load(db);
        try (Cursor c = ctx.getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, proj.toArray(new String[0]),
                MediaStore.Audio.Media.IS_MUSIC + " != 0", null, null)) {
            if (c != null) while (c.moveToNext()) {
                Track t = new Track();
                t.mediaId = c.getLong(0);
                t.title = nz(c.getString(1));
                t.artist = cleanArtist(c.getString(2));
                t.album = nz(c.getString(3));
                t.albumKey = String.valueOf(c.getLong(4));
                t.duration = c.getLong(5);
                int tr = c.getInt(6);
                t.disc = Math.max(1, tr / 1000); t.track = tr % 1000;
                t.year = c.getInt(7);
                long added = c.getLong(8) * 1000, mod = c.getLong(9) * 1000;
                // 기기로 옮긴 날보다 파일을 받은 날이 이를 수 있어 둘 중 이른 쪽을 수집한 날로 본다
                t.addedAt = (added > 0 && mod > 0) ? Math.min(added, mod) : Math.max(added, mod);
                t.mime = c.getString(10) == null ? "audio/mpeg" : c.getString(10);
                t.size = c.getLong(11);
                t.albumArtist = cleanArtist(c.getString(12));
                String path = c.getString(13);
                String folder = FolderFilter.norm(c.getString(14));
                if (hasGenre) t.genre = nz(c.getString(15));
                if (t.duration < 1000) continue;
                folders.merge(folder, 1, Integer::sum);
                if (!filter.includes(folder)) continue;
                t.id = keyOf(t);
                Track kept = ids.get(t.id); // 같은 곡이 두 번 들어 있으면 하나만
                if (kept == null) { ids.put(t.id, t); list.add(t); kept = t; }
                byMedia.put(t.mediaId, kept);
                if (path != null && !path.isEmpty()) byPath.put(PlaylistImport.normPath(path), kept);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "no permission", e);
        }

        // 처음 보는 곡에 수집 번호를 붙인다
        Map<String, Db.Meta> meta = db.allMeta();
        List<Track> fresh = new ArrayList<>();
        for (Track t : list) if (!meta.containsKey(t.id)) fresh.add(t);
        fresh.sort((a, b) -> a.addedAt != b.addedAt ? Long.compare(a.addedAt, b.addedAt)
                : a.album.equals(b.album) ? Integer.compare(a.disc * 1000 + a.track, b.disc * 1000 + b.track) : a.album.compareTo(b.album));
        db.assignNumbers(fresh);

        PlaylistImport.importAll(ctx, db, byMedia, byPath);

        Map<String, Track> rep = new HashMap<>();
        for (Track t : list) if (!rep.containsKey(t.albumKey)) rep.put(t.albumKey, t);
        tracks = list; byId = ids; albumRep = rep; folderCounts = folders; scanned = true;
        Log.i(TAG, "scanned " + list.size() + " tracks (" + fresh.size() + " new) in " + (System.currentTimeMillis() - t0) + "ms");
    }

    private static String nz(String s) { return s == null ? "" : s.trim(); }
    private static String cleanArtist(String s) {
        s = nz(s);
        return "<unknown>".equalsIgnoreCase(s) ? "" : s;
    }

    /** 곡 키: 제목·아티스트·앨범·길이(초)로 만든다. 같은 파일이면 어디로 옮겨도 같다. */
    static String keyOf(Track t) {
        String raw = t.title.toLowerCase(Locale.ROOT) + "\u0001" + t.artist.toLowerCase(Locale.ROOT) + "\u0001"
                + t.album.toLowerCase(Locale.ROOT) + "\u0001" + Math.round(t.duration / 1000.0);
        try {
            byte[] h = MessageDigest.getInstance("SHA-1").digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) sb.append(String.format(Locale.ROOT, "%02x", h[i]));
            return sb.toString();
        } catch (Exception e) { return Integer.toHexString(raw.hashCode()); }
    }

    /** 설정 화면의 폴더 목록: 폴더마다 곡 수와 지금 꺼져 있는지 */
    public String foldersJson() throws JSONException {
        FolderFilter f = FolderFilter.load(db);
        JSONArray arr = new JSONArray(), off = new JSONArray();
        for (Map.Entry<String, Integer> e : folderCounts.entrySet()) {
            arr.put(new JSONObject().put("path", e.getKey()).put("count", e.getValue()));
            if (!f.includes(e.getKey())) off.put(e.getKey());
        }
        return new JSONObject().put("folders", arr).put("off", off).put("autoNew", f.autoNew).toString();
    }

    /** 폴더 설정을 저장하고 다시 읽는다. 지금 있는 폴더들을 "아는 폴더"로 남긴다 */
    public void setFolders(List<String> off, boolean autoNew) {
        FolderFilter.save(db, off, new ArrayList<>(folderCounts.keySet()), autoNew);
        scan();
    }

    public String libraryJson() throws JSONException {
        Map<String, Db.Meta> meta = db.allMeta();
        JSONArray arr = new JSONArray();
        for (Track t : tracks) {
            Db.Meta m = meta.get(t.id);
            JSONObject o = new JSONObject();
            o.put("id", t.id); o.put("n", m == null ? 0 : m.no);
            o.put("title", t.title); o.put("artist", t.artist); o.put("albumArtist", t.albumArtist);
            o.put("album", t.album); o.put("albumKey", t.albumKey);
            if (t.year > 0) o.put("year", t.year);
            if (t.genre != null && !t.genre.isEmpty()) o.put("genre", t.genre);
            o.put("track", t.track); o.put("disc", t.disc); o.put("duration", t.duration);
            o.put("addedAt", m != null && m.addedAt > 0 ? m.addedAt : t.addedAt);
            if (m != null) {
                o.put("plays", m.plays); o.put("listenedMs", m.listenedMs);
                if (m.firstPlayed > 0) o.put("firstPlayed", m.firstPlayed);
                if (m.lastPlayed > 0) o.put("lastPlayed", m.lastPlayed);
                if (m.fav) { o.put("fav", true); o.put("favAt", m.favAt); }
                if (m.memo != null && !m.memo.isEmpty()) o.put("memo", m.memo);
            }
            arr.put(o);
        }
        return new JSONObject().put("tracks", arr).toString();
    }

    public JSONObject lyrics(String id) throws JSONException {
        JSONObject cached = lyricsCache.get(id);
        if (cached != null) return cached;
        Track t = get(id);
        JSONObject res = new JSONObject();
        String[] made = t == null ? null : db.lyrics(id);
        List<Id3Lyrics.Line> madeLines = made == null ? null : Id3Lyrics.parseLrc(made[0]);
        if (madeLines != null && !madeLines.isEmpty()) {
            JSONArray a = new JSONArray();
            for (Id3Lyrics.Line l : madeLines) a.put(new JSONArray().put(l.ms).put(l.text));
            res.put("synced", a);
            res.put("plain", JSONObject.NULL);
            res.put("source", made[1] == null ? "made" : made[1]);
        } else if (t != null) {
            Id3Lyrics.Result r = Id3Lyrics.read(ctx, t.uri());
            if (r.synced != null && !r.synced.isEmpty()) {
                JSONArray a = new JSONArray();
                for (Id3Lyrics.Line l : r.synced) a.put(new JSONArray().put(l.ms).put(l.text));
                res.put("synced", a);
            } else res.put("synced", JSONObject.NULL);
            res.put("plain", r.plain == null || r.plain.trim().isEmpty() ? JSONObject.NULL : r.plain);
            res.put("source", "file");
        }
        lyricsCache.put(id, res);
        return res;
    }

    public void forgetLyrics(String id) { lyricsCache.remove(id); }
    public void forgetAllLyrics() { lyricsCache.clear(); }

    /** 재생기에 넣을 항목. 화면에서는 id만 넘기고 여기서 파일·표시 정보를 채운다. */
    public MediaItem toMediaItem(String id) {
        Track t = get(id);
        if (t == null) return null;
        MediaMetadata md = new MediaMetadata.Builder()
                .setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album)
                .setAlbumArtist(t.albumArtist.isEmpty() ? null : t.albumArtist)
                .setArtworkUri(Uri.parse("http://127.0.0.1:" + WebServer.PORT + "/api/art/" + t.albumKey + "?s=640"))
                .setIsPlayable(true).setIsBrowsable(false)
                .build();
        return new MediaItem.Builder().setMediaId(t.id).setUri(t.uri()).setMimeType(t.mime).setMediaMetadata(md).build();
    }
}
