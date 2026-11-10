package io.github.huny4daniel.musiccollection;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
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
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 다른 플레이어가 만든 재생목록(MediaStore에 등록된 재생목록, 저장소의 .m3u/.m3u8 파일)을 가져온다.
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
        try (Cursor c = ctx.getContentResolver().query(plUri, proj, null, null, null)) {
            if (c != null) while (c.moveToNext()) {
                long id = c.getLong(0);
                String name = c.getString(1) == null ? "" : c.getString(1).trim();
                String data = c.getString(2);
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
        if (count > 0) Log.i(TAG, "imported/updated " + count + " playlists");
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
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (raw == null) return new ArrayList<>(out);

        String dir = data == null ? "" : normPath(data);
        int slash = dir.lastIndexOf('/');
        dir = slash >= 0 ? dir.substring(0, slash) : "";
        String extArtist = null, extTitle = null;
        for (String line : decode(raw).split("\\r?\\n|\\r")) {
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
