package io.github.huny4daniel.musiccollection;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 다른 플레이어가 만든 재생목록(MediaStore에 등록된 재생목록, 저장소의 .m3u/.m3u8 파일,
 * 사용자가 고른 폴더의 .smpl(삼성뮤직)/.m3u/.m3u8 파일)을 가져온다.
 * 라이브러리를 읽을 때마다 불리며, 한 번 가져온 재생목록은 이 앱에서 고치거나 지우기 전까지만 원본을 따라간다.
 */
final class PlaylistImport {
    private static final String TAG = "PlaylistImport";

    private PlaylistImport() {}

    @SuppressWarnings("deprecation")
    static void importAll(Context ctx, Db db, Map<Long, Track> byMedia, Map<String, Track> byPath) {
        if (byMedia.isEmpty()) return; // 곡을 못 읽었을 때(권한 없음 등) 빈 재생목록을 만들지 않는다
        Map<String, Track> byFile = new HashMap<>();
        Map<String, Integer> fileCount = new HashMap<>();
        for (Map.Entry<String, Track> e : byPath.entrySet()) {
            String f = fileName(e.getKey());
            Integer n = fileCount.get(f);
            fileCount.put(f, n == null ? 1 : n + 1);
            byFile.put(f, e.getValue());
        }
        Map<String, Track> byTag = new HashMap<>();
        for (Track t : byMedia.values()) byTag.put(tagKey(t.artist, t.title), t);

        Uri plUri = MediaStore.Audio.Playlists.EXTERNAL_CONTENT_URI;
        String[] proj = {MediaStore.Audio.Playlists._ID, MediaStore.Audio.Playlists.NAME, MediaStore.Audio.Playlists.DATA};
        int count = 0;
        String exportDir = PlaylistExport.pathPrefix(db); // 테이프 저장 폴더 (이 앱이 만든 파일이 MediaStore에 잡혀도 다시 가져오지 않게)
        try (Cursor c = ctx.getContentResolver().query(plUri, proj, null, null, null)) {
            if (c != null) while (c.moveToNext()) {
                long id = c.getLong(0);
                String name = c.getString(1) == null ? "" : c.getString(1).trim();
                String data = c.getString(2);
                if (exportDir != null && data != null && normPath(data).startsWith(exportDir + "/")) continue;
                if (name.isEmpty() && data != null) name = stripExt(fileName(normPath(data)));
                if (name.isEmpty()) continue;

                List<String> items = members(ctx, id, byMedia);
                if (items.isEmpty()) items = parseFile(ctx, ContentUris.withAppendedId(plUri, id), data, byPath, byFile, fileCount, byTag);
                if (items.isEmpty()) continue;
                String key = data != null && !data.isEmpty() ? "path:" + normPath(data) : "name:" + name;
                try {
                    if (db.syncImportedPlaylist(key, name, items)) count++;
                } catch (Exception e) { Log.w(TAG, "save " + name, e); }
            }
        } catch (Exception e) {
            Log.w(TAG, "playlists", e);
        }
        count += importFolder(ctx, db, byPath, byFile, fileCount, byTag);
        if (count > 0) Log.i(TAG, "imported/updated " + count + " playlists");
    }

    static final String K_DIR = "playlist_dir";

    /**
     * 설정에서 고른 폴더(SAF)의 재생목록 파일들. 다른 앱이 만든 파일은 MediaStore로 보이지 않아 폴더 권한으로 직접 읽는다.
     * 바로 아래 하위 폴더는 상자로 본다: 그 안의 재생목록은 처음 가져올 때 그 폴더 이름의 상자에 넣는다
     * (그 뒤 이 앱에서 다른 상자로 옮기면 그대로 둔다 — 원본은 고치기 전까지만 따라간다)
     */
    private static int importFolder(Context ctx, Db db, Map<String, Track> byPath, Map<String, Track> byFile,
                                    Map<String, Integer> fileCount, Map<String, Track> byTag) {
        String dir = db.get(K_DIR, null);
        if (dir == null || dir.isEmpty()) return 0;
        if (dir.equals(db.get(PlaylistExport.K_DIR, ""))) return 0; // 테이프 저장 폴더와 같으면 그쪽(양방향 동기화)이 맡는다
        int count = 0;
        try {
            Uri tree = Uri.parse(dir);
            String root = DocumentsContract.getTreeDocumentId(tree);
            count += importDocs(ctx, db, tree, root, null, byPath, byFile, fileCount, byTag);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, root);
            try (Cursor c = ctx.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c != null) while (c.moveToNext()) {
                    String docId = c.getString(0), name = c.getString(1);
                    if (docId == null || name == null || name.startsWith(".") || !DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                    count += importDocs(ctx, db, tree, docId, name.trim(), byPath, byFile, fileCount, byTag);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "folder " + dir, e); // 권한이 풀렸거나 폴더가 사라짐
        }
        return count;
    }

    /** 폴더 하나의 재생목록 파일들. box가 있으면 새로 가져온 재생목록을 그 이름의 상자에 넣는다 */
    private static int importDocs(Context ctx, Db db, Uri tree, String parent, String box, Map<String, Track> byPath, Map<String, Track> byFile,
                                  Map<String, Integer> fileCount, Map<String, Track> byTag) {
        int count = 0;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent);
        try (Cursor c = ctx.getContentResolver().query(children, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null) while (c.moveToNext()) {
                String docId = c.getString(0), file = c.getString(1);
                if (docId == null || file == null) continue;
                String lower = file.toLowerCase(Locale.ROOT);
                boolean smpl = lower.endsWith(".smpl");
                if (!smpl && !lower.endsWith(".m3u") && !lower.endsWith(".m3u8")) continue;
                byte[] raw;
                try (InputStream in = ctx.getContentResolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, docId))) {
                    raw = readAll(in);
                } catch (Exception e) { Log.w(TAG, "read " + file, e); continue; }
                if (raw == null) continue;
                String[] name = {stripExt(file).trim()};
                List<String> items = smpl ? parseSmpl(raw, name, byPath, byFile, fileCount, byTag)
                        : parseM3u(raw, "", byPath, byFile, fileCount, byTag);
                if (items.isEmpty() || name[0].isEmpty()) continue;
                String key = "doc:" + docId;
                boolean fresh = db.importedPlaylistId(key) == null;
                try {
                    if (db.syncImportedPlaylist(key, name[0], items)) count++;
                    String id = db.importedPlaylistId(key);
                    if (fresh && box != null && !box.isEmpty() && id != null) db.putInBoxByName(id, box);
                } catch (Exception e) { Log.w(TAG, "save " + name[0], e); }
            }
        } catch (Exception e) {
            Log.w(TAG, "folder docs", e);
        }
        return count;
    }

    /**
     * 삼성뮤직이 내보낸 .smpl (JSON): name, members[{info: 파일 경로, artist, title, order}].
     * name[0]에 재생목록 이름을 돌려준다
     */
    private static List<String> parseSmpl(byte[] raw, String[] name, Map<String, Track> byPath, Map<String, Track> byFile,
                                          Map<String, Integer> fileCount, Map<String, Track> byTag) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        try {
            JSONObject o = new JSONObject(decode(raw));
            String n = o.optString("name", "").trim();
            if (!n.isEmpty()) name[0] = n;
            JSONArray m = o.optJSONArray("members");
            if (m == null) return new ArrayList<>(out);
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; i < m.length(); i++) { JSONObject x = m.optJSONObject(i); if (x != null) list.add(x); }
            list.sort(Comparator.comparingInt(x -> x.optInt("order", 0)));
            for (JSONObject x : list) {
                String info = x.optString("info", "");
                Track t = info.isEmpty() ? null : resolve(info, "", byPath, byFile, fileCount);
                if (t == null) t = byTag.get(tagKey(x.optString("artist", ""), x.optString("title", "")));
                if (t != null) out.add(t.id);
            }
        } catch (Exception e) {
            Log.w(TAG, "smpl", e);
        }
        return new ArrayList<>(out);
    }

    /** MediaStore가 기억하는 재생목록의 곡 순서 */
    @SuppressWarnings("deprecation")
    private static List<String> members(Context ctx, long playlistId, Map<Long, Track> byMedia) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        Uri u = MediaStore.Audio.Playlists.Members.getContentUri("external", playlistId);
        try (Cursor c = ctx.getContentResolver().query(u, new String[]{MediaStore.Audio.Playlists.Members.AUDIO_ID},
                null, null, MediaStore.Audio.Playlists.Members.PLAY_ORDER)) {
            if (c != null) while (c.moveToNext()) {
                Track t = byMedia.get(c.getLong(0));
                if (t != null) out.add(t.id);
            }
        } catch (Exception e) {
            Log.w(TAG, "members " + playlistId, e);
        }
        return new ArrayList<>(out);
    }

    /** MediaStore가 곡을 연결하지 못한 재생목록은 .m3u 파일을 직접 읽어 경로·파일명·태그로 곡을 찾는다 */
    private static List<String> parseFile(Context ctx, Uri uri, String data, Map<String, Track> byPath,
                                          Map<String, Track> byFile, Map<String, Integer> fileCount, Map<String, Track> byTag) {
        byte[] raw = null;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) { raw = readAll(in); } catch (Exception ignored) {}
        if (raw == null && data != null) {
            try (InputStream in = new FileInputStream(data)) { raw = readAll(in); } catch (Exception ignored) {}
        }
        if (raw == null) return new ArrayList<>();
        String dir = data == null ? "" : normPath(data);
        int slash = dir.lastIndexOf('/');
        dir = slash >= 0 ? dir.substring(0, slash) : "";
        return parseM3u(raw, dir, byPath, byFile, fileCount, byTag);
    }

    private static List<String> parseM3u(byte[] raw, String dir, Map<String, Track> byPath, Map<String, Track> byFile,
                                         Map<String, Integer> fileCount, Map<String, Track> byTag) {
        String text = decode(raw);
        if (text.contains(PlaylistExport.MARK)) return new ArrayList<>(); // 이 앱이 테이프를 저장한 파일
        return parseLines(text, dir, byPath, byFile, fileCount, byTag);
    }

    /** 테이프 저장 폴더의 파일을 다시 읽을 때 (밖에서 고친 내용을 앱에 반영): 이 앱이 쓴 파일도 읽는다 */
    static List<String> parseTapeText(String text, List<Track> all) {
        Map<String, Track> byPath = new HashMap<>(), byFile = new HashMap<>(), byTag = new HashMap<>();
        Map<String, Integer> fileCount = new HashMap<>();
        for (Track t : all) {
            byTag.put(tagKey(t.artist, t.title), t);
            if (t.path == null || t.path.isEmpty()) continue;
            String p = normPath(t.path), f = fileName(p);
            byPath.put(p, t); byFile.put(f, t); fileCount.merge(f, 1, Integer::sum);
        }
        return parseLines(text, "", byPath, byFile, fileCount, byTag);
    }

    static String readText(InputStream in) throws java.io.IOException {
        byte[] raw = readAll(in);
        return raw == null ? null : decode(raw);
    }

    private static List<String> parseLines(String text, String dir, Map<String, Track> byPath, Map<String, Track> byFile,
                                           Map<String, Integer> fileCount, Map<String, Track> byTag) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        String extArtist = null, extTitle = null;
        for (String line : text.split("\\r?\\n|\\r")) {
            line = line.trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("#")) {
                if (line.toUpperCase(Locale.ROOT).startsWith("#EXTINF:")) {
                    int comma = line.indexOf(',');
                    String info = comma >= 0 ? line.substring(comma + 1).trim() : "";
                    int dash = info.indexOf(" - ");
                    extArtist = dash >= 0 ? info.substring(0, dash) : "";
                    extTitle = dash >= 0 ? info.substring(dash + 3) : info;
                }
                continue;
            }
            Track t = resolve(line, dir, byPath, byFile, fileCount);
            if (t == null && extTitle != null) t = byTag.get(tagKey(extArtist, extTitle));
            if (t != null) out.add(t.id);
            extArtist = extTitle = null;
        }
        return new ArrayList<>(out);
    }

    private static Track resolve(String entry, String dir, Map<String, Track> byPath, Map<String, Track> byFile, Map<String, Integer> fileCount) {
        if (entry.regionMatches(true, 0, "file://", 0, 7)) {
            entry = entry.substring(7);
            try { entry = URLDecoder.decode(entry.replace("+", "%2B"), "UTF-8"); } catch (Exception ignored) {}
        }
        String p = normPath(entry);
        Track t = byPath.get(p);
        if (t == null && !p.startsWith("/") && !dir.isEmpty()) t = byPath.get(normPath(dir + "/" + p));
        if (t == null) {
            // 다른 기기·PC에서 만든 목록은 경로 앞부분이 다르므로, 같은 이름의 파일이 하나뿐일 때만 파일명으로 찾는다
            String f = fileName(p);
            Integer n = fileCount.get(f);
            if (n != null && n == 1) t = byFile.get(f);
        }
        return t;
    }

    /** 비교용 경로: 구분자 통일, 「.」「..」 정리, 소문자 */
    static String normPath(String p) {
        p = p.replace('\\', '/');
        boolean abs = p.startsWith("/");
        List<String> parts = new ArrayList<>();
        for (String s : p.split("/")) {
            if (s.isEmpty() || s.equals(".")) continue;
            if (s.equals("..")) { if (!parts.isEmpty()) parts.remove(parts.size() - 1); continue; }
            parts.add(s);
        }
        return ((abs ? "/" : "") + String.join("/", parts)).toLowerCase(Locale.ROOT);
    }

    private static String fileName(String p) {
        int i = p.lastIndexOf('/');
        return i >= 0 ? p.substring(i + 1) : p;
    }

    private static String stripExt(String f) {
        int i = f.lastIndexOf('.');
        return i > 0 ? f.substring(0, i) : f;
    }

    private static String tagKey(String artist, String title) {
        return (artist == null ? "" : artist.trim().toLowerCase(Locale.ROOT)) + "\u0001" + (title == null ? "" : title.trim().toLowerCase(Locale.ROOT));
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        if (in == null) return null;
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            bo.write(buf, 0, n);
            if (bo.size() > 4 * 1024 * 1024) break; // 재생목록이라기엔 너무 큰 파일
        }
        return bo.toByteArray();
    }

    /** .m3u8은 UTF-8, 예전 Windows 플레이어가 만든 .m3u는 CP949인 경우가 많다 */
    private static String decode(byte[] raw) {
        int off = raw.length >= 3 && (raw[0] & 0xff) == 0xef && (raw[1] & 0xff) == 0xbb && (raw[2] & 0xff) == 0xbf ? 3 : 0;
        ByteBuffer bb = ByteBuffer.wrap(raw, off, raw.length - off);
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(bb).toString();
        } catch (CharacterCodingException e) {
            try { return new String(raw, off, raw.length - off, Charset.forName("MS949")); }
            catch (Exception e2) { return new String(raw, off, raw.length - off, StandardCharsets.ISO_8859_1); }
        }
    }
}
