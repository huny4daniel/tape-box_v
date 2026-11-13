package io.github.huny4daniel.musiccollection;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 내가 만든 테이프를 설정에서 고른 폴더(SAF)에 .m3u8 파일로 저장해 두고, 테이프가 바뀔 때마다 따라 고친다.
 *  - 상자 밖 테이프는 폴더 바로 아래, 상자에 든 테이프는 그 상자 이름의 하위 폴더에
 *  - 이름을 바꾸거나 상자를 옮기면 파일도 옮기고, 테이프·상자를 지우면 파일·빈 폴더도 지운다
 *  - 파일마다 "#TAPEBOX:" 표시를 넣어, 이 앱의 가져오기가 자기가 만든 파일을 다시 가져오지 않게 한다
 *  - 어떤 파일을 만들었는지 기록(K_MAP)해 두고 그 파일만 고치거나 지운다 (폴더의 다른 파일은 건드리지 않는다)
 *
 * 양방향: 저장 폴더의 파일을 밖에서 고치면(다른 앱·PC·파일 관리자) 앱의 테이프에도 반영한다 (pull)
 *  - 곡 목록·순서를 고치면 → 테이프의 곡 / 파일 이름이나 #PLAYLIST 줄을 고치면 → 테이프 이름
 *  - 다른 하위 폴더로 옮기면 → 그 이름의 상자로 (폴더 바로 아래로 옮기면 상자에서 뺀다) / 상자 폴더 이름을 바꾸면 → 상자 이름
 *  - 새 재생목록 파일을 넣으면 → 새 테이프 (하위 폴더에 넣었으면 그 상자에)
 *  - 파일을 지우면 → 테이프는 지우지 않고 파일을 다시 만든다 (폴더가 잠깐 안 보이는 것만으로 테이프가 사라지지 않게. 테이프는 앱에서 지운다)
 *  - 앱과 파일이 둘 다 바뀌었으면 → 나중에 바뀐 쪽을 따른다 (테이프 단위)
 *  - 히스토리 상자 파일은 기록에서 만드는 것이라 밖에서 고쳐도 다음 저장 때 되돌아간다
 */
final class PlaylistExport {
    private static final String TAG = "PlaylistExport";
    static final String K_DIR = "export_dir";
    static final String K_MAP = "export_map";
    static final String K_AUTO = "export_auto"; // "0"이면 자동 저장을 끈다 (「지금 저장」으로만)
    static final String K_HIST = "export_hist"; // "0"이면 히스토리 상자는 저장하지 않는다 (이미 만든 히스토리 파일은 그대로 둔다)
    static final String MARK = "#TAPEBOX:";
    private static final String MIME = "application/octet-stream"; // 이름 끝에 확장자를 덧붙이지 않게
    private static final ExecutorService EX = Executors.newSingleThreadExecutor();
    private static final Handler H = new Handler(Looper.getMainLooper());
    private static Runnable pending;

    private PlaylistExport() {}

    static boolean auto(Db db) { return !"0".equals(db.get(K_AUTO, "1")); }
    static boolean hist(Db db) { return !"0".equals(db.get(K_HIST, "1")); }

    /** 테이프·상자가 바뀌면 부른다 (자동 저장을 껐으면 아무것도 안 한다). 잇달아 바뀌어도 1.5초 뒤 한 번만 저장한다 */
    static void schedule(App app) {
        if (auto(app.db)) saveSoon(app);
    }

    /** 자동 저장과 상관없이 곧 저장한다 (「지금 저장」, 폴더를 새로 골랐을 때) */
    static void saveSoon(App app) {
        if (app.db.get(K_DIR, "").isEmpty()) return;
        H.post(() -> {
            if (pending != null) H.removeCallbacks(pending);
            pending = () -> EX.execute(() -> {
                try { sync(app); } catch (Exception e) { Log.w(TAG, "sync", e); }
            });
            H.postDelayed(pending, 1500);
        });
    }

    /** 밖에서 고친 파일을 곧 앱에 반영한다 (앱으로 돌아왔을 때 등). 바뀐 게 있으면 화면에 알리고 파일을 다시 맞춘다 */
    static void pullSoon(App app) {
        if (app.db.get(K_DIR, "").isEmpty()) return;
        EX.execute(() -> {
            try { if (pull(app)) { app.emit("{\"type\":\"library\"}"); if (auto(app.db)) sync(app); } } catch (Exception e) { Log.w(TAG, "pull", e); }
        });
    }

    /** 고른 폴더가 실제 경로로 어디인지 ("primary:Music/Tapes" → "/storage/emulated/0/music/tapes"). 모르면 null */
    static String pathPrefix(Db db) {
        String dir = db.get(K_DIR, "");
        if (dir.isEmpty()) return null;
        try {
            String id = DocumentsContract.getTreeDocumentId(Uri.parse(dir));
            int i = id.indexOf(':'); if (i < 0) return null;
            String vol = id.substring(0, i), rel = id.substring(i + 1);
            String base = "primary".equalsIgnoreCase(vol) ? "/storage/emulated/0" : "/storage/" + vol;
            return PlaylistImport.normPath(base + "/" + rel);
        } catch (Exception e) { return null; }
    }

    private static String safe(String s) {
        s = s == null ? "" : s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.length() > 80) s = s.substring(0, 80).trim();
        return s.isEmpty() ? "테이프" : s;
    }

    private static String content(App app, JSONObject pl) throws Exception {
        StringBuilder b = new StringBuilder("#EXTM3U\n");
        b.append(MARK).append(pl.getString("id")).append('\n');
        b.append("#PLAYLIST:").append(pl.optString("name", "")).append('\n');
        JSONArray items = pl.optJSONArray("items");
        if (items != null) for (int i = 0; i < items.length(); i++) {
            Track t = app.library.get(items.optString(i));
            if (t == null || t.path == null || t.path.isEmpty()) continue; // 지금 컬렉션에 없는 곡은 뺀다
            b.append("#EXTINF:").append(t.duration / 1000).append(',').append(t.artist).append(" - ").append(t.title).append('\n');
            b.append(t.path).append('\n');
        }
        return b.toString();
    }

    /** 상자 id → 그 상자의 폴더 이름 (상자 이름이 겹치면 뒤에 번호). 순서는 상자 순서 */
    private static Map<String, String> boxFolders(JSONArray boxes) throws Exception {
        Map<String, String> out = new LinkedHashMap<>();
        Set<String> used = new HashSet<>();
        for (int i = 0; i < boxes.length(); i++) {
            JSONObject bx = boxes.getJSONObject(i);
            String f = safe(bx.optString("name")), base = f;
            for (int n = 2; used.contains(f.toLowerCase(Locale.ROOT)); n++) f = base + " (" + n + ")";
            used.add(f.toLowerCase(Locale.ROOT));
            out.put(bx.getString("id"), f);
        }
        return out;
    }

    private static String histFolderName(Map<String, String> boxFolders) {
        Set<String> used = new HashSet<>();
        for (String f : boxFolders.values()) used.add(f.toLowerCase(Locale.ROOT));
        String f = "히스토리 상자", base = f;
        for (int n = 2; used.contains(f.toLowerCase(Locale.ROOT)); n++) f = base + " (" + n + ")";
        return f;
    }

    private static String hash(String text) { return Integer.toHexString(text.replace("\r\n", "\n").hashCode()); }

    /** 저장 폴더에 있는 재생목록 파일 하나 */
    private static final class Found {
        String doc, folder, file, text, mark; long modified;
        String path() { return folder + "/" + file; }
    }

    private static void listFiles(ContentResolver cr, Uri tree, String parent, String folder, List<Found> out, List<String[]> dirsOut) {
        try (Cursor c = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent), new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String doc = c.getString(0), name = c.getString(1);
                if (doc == null || name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) { if (dirsOut != null) dirsOut.add(new String[]{doc, name}); continue; }
                String lower = name.toLowerCase(Locale.ROOT);
                if (!lower.endsWith(".m3u8") && !lower.endsWith(".m3u")) continue;
                Found f = new Found();
                f.doc = doc; f.folder = folder; f.file = name; f.modified = c.isNull(3) ? 0 : c.getLong(3);
                out.add(f);
            }
        }
    }

    private static String stripExt(String f) { int i = f.lastIndexOf('.'); return i > 0 ? f.substring(0, i) : f; }
    private static String baseOf(String path) { return stripExt(path.substring(path.lastIndexOf('/') + 1)); }

    /** 파일에 적힌 #PLAYLIST: 이름 */
    private static String plName(String text) {
        for (String line : text.split("\\r?\\n|\\r")) if (line.startsWith("#PLAYLIST:")) return line.substring(10).trim();
        return null;
    }

    /**
     * 밖에서 고친 파일을 앱의 테이프·상자에 반영한다. 바뀐 게 있으면 true.
     * 이 앱이 마지막으로 쓴 내용(hash)·자리(path)와 다른 파일만 본다.
     */
    static synchronized boolean pull(App app) throws Exception {
        String dir = app.db.get(K_DIR, "");
        if (dir.isEmpty() || !app.library.isScanned()) return false;
        ContentResolver cr = app.getContentResolver();
        Uri tree = Uri.parse(dir);
        String rootDoc = DocumentsContract.getTreeDocumentId(tree);
        Db db = app.db;

        List<Found> found = new java.util.ArrayList<>();
        List<String[]> subdirs = new java.util.ArrayList<>();
        try { listFiles(cr, tree, rootDoc, "", found, subdirs); }
        catch (Exception e) { Log.w(TAG, "list", e); return false; } // 폴더가 안 보이면 아무것도 바꾸지 않는다
        Map<String, String> boxFolder = boxFolders(db.boxes());
        String histFolder = histFolderName(boxFolder);
        Set<String> diskFolders = new HashSet<>();
        for (String[] d : subdirs) {
            diskFolders.add(d[1].toLowerCase(Locale.ROOT));
            if (d[1].equalsIgnoreCase(histFolder)) continue;
            try { listFiles(cr, tree, d[0], d[1], found, null); } catch (Exception e) { Log.w(TAG, "list " + d[1], e); }
        }

        JSONObject map = new JSONObject(db.get(K_MAP, "{}"));
        JSONObject files = map.optJSONObject("files"); if (files == null) files = new JSONObject();
        // 표시 없는 파일이라도 이미 기록된 자리(바로 전 pull이 새 테이프로 만들고 아직 표시를 쓰기 전)면 그 테이프의 파일로 본다
        Map<String, String> idByDoc = new HashMap<>();
        for (java.util.Iterator<String> it = files.keys(); it.hasNext(); ) {
            String id = it.next(); JSONObject e = files.optJSONObject(id);
            if (e != null && !e.optString("doc").isEmpty()) idByDoc.put(e.optString("doc"), id);
        }
        // 내용을 읽고 #TAPEBOX: 표시를 찾는다. 같은 표시가 둘 이상이면(파일을 복사함) 기록된 자리의 것이 원본, 나머지는 새 테이프
        Map<String, Found> byMark = new HashMap<>();
        List<Found> fresh = new java.util.ArrayList<>();
        for (Found f : found) {
            try (java.io.InputStream in = cr.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, f.doc))) { f.text = PlaylistImport.readText(in); }
            catch (Exception e) { Log.w(TAG, "read " + f.path(), e); continue; }
            if (f.text == null) continue;
            for (String line : f.text.split("\\r?\\n|\\r")) if (line.startsWith(MARK)) { f.mark = line.substring(MARK.length()).trim(); break; }
            if (f.mark == null) {
                String known = idByDoc.get(f.doc);
                if (known != null && !known.startsWith("hist-") && db.playlist(known) != null) f.mark = known;
            }
            if (f.mark == null || f.mark.startsWith("hist-")) { if (f.mark == null) fresh.add(f); continue; }
            Found had = byMark.get(f.mark);
            JSONObject e = files.optJSONObject(f.mark);
            boolean orig = e != null && f.path().equals(e.optString("path"));
            if (had == null) byMark.put(f.mark, f);
            else if (orig) { fresh.add(had); byMark.put(f.mark, f); }
            else fresh.add(f);
        }

        boolean changed = false, mapDirty = false;
        List<Track> all = app.library.all();
        for (Map.Entry<String, Found> en : byMark.entrySet()) {
            String id = en.getKey(); Found f = en.getValue();
            JSONObject pl = db.playlist(id);
            if (pl == null) { fresh.add(f); continue; } // 앱에 없는 테이프의 파일(다른 기기에서 가져온 것 등) → 새 테이프로
            JSONObject e = files.optJSONObject(id);
            String h = hash(f.text);
            if (e != null && h.equals(e.optString("hash")) && f.path().equals(e.optString("path"))) continue; // 이 앱이 쓴 그대로
            // 둘 다 바뀌었으면 나중에 바뀐 쪽: 앱이 더 나중이면 그대로 두고 다음 저장 때 파일을 덮어쓴다
            long at = e == null ? 0 : e.optLong("at", 0), updated = pl.optLong("updated", 0);
            if (updated > at && updated >= f.modified) {
                // 기록이 없던 파일(폴더를 새로 고른 뒤 등)이면 자리만 적어 두어, 다음 저장 때 새 파일을 또 만들지 않고 이 파일을 덮어쓰게
                if (e == null) { files.put(id, new JSONObject().put("doc", f.doc).put("path", f.path()).put("hash", "").put("at", 0)); mapDirty = true; }
                continue;
            }

            JSONObject patch = new JSONObject();
            String fileName = baseOf(f.path()), inside = plName(f.text);
            if (e != null && !fileName.equals(baseOf(e.optString("path")))) patch.put("name", fileName); // 파일 이름을 바꿈
            else if (inside != null && !inside.isEmpty() && !inside.equals(pl.optString("name"))) patch.put("name", inside); // #PLAYLIST 줄을 고침
            else if (e == null && !safe(pl.optString("name")).equals(fileName.replaceAll(" \\(\\d+\\)$", ""))) patch.put("name", fileName);
            if (e == null || !h.equals(e.optString("hash"))) {
                List<String> items = PlaylistImport.parseTapeText(f.text, all);
                // 지금 컬렉션에 없는 곡은 파일에 쓰지 않았으므로, 있는 곡만 비교해 다를 때만 바꾼다 (없는 곡이 지워지지 않게)
                JSONArray cur = pl.optJSONArray("items"); List<String> present = new java.util.ArrayList<>();
                if (cur != null) for (int i = 0; i < cur.length(); i++) if (app.library.get(cur.optString(i)) != null) present.add(cur.optString(i));
                if (!items.equals(present)) patch.put("items", new JSONArray(items));
            }
            if (patch.length() > 0) { db.updatePlaylist(id, patch); changed = true; }
            if (placeInBox(db, id, f.folder, boxFolder, diskFolders)) { changed = true; boxFolder = boxFolders(db.boxes()); }
            // 이 파일을 반영했다고 적어 둔다 (이 앱이 다시 쓸 때까지 같은 내용을 또 반영하지 않게)
            files.put(id, new JSONObject().put("doc", f.doc).put("path", f.path()).put("hash", h).put("at", System.currentTimeMillis()));
        }
        // 새로 넣은 재생목록 파일 → 새 테이프. 그 파일 자리를 기록해 두어 다음 저장 때 같은 파일에 #TAPEBOX: 표시를 넣어 쓴다
        for (Found f : fresh) {
            if (f.folder.equalsIgnoreCase(histFolder)) continue;
            List<String> items = PlaylistImport.parseTapeText(f.text, all);
            String name = baseOf(f.path());
            if (items.isEmpty() || name.trim().isEmpty()) continue;
            JSONObject made = db.createPlaylist(name.trim(), new JSONArray(items));
            String id = made.getString("id");
            placeInBox(db, id, f.folder, boxFolder, diskFolders);
            boxFolder = boxFolders(db.boxes());
            files.put(id, new JSONObject().put("doc", f.doc).put("path", f.path()).put("hash", hash(f.text)).put("at", System.currentTimeMillis()));
            changed = true;
        }
        if (changed || mapDirty) { map.put("files", files); db.put(K_MAP, map.toString()); }
        return changed;
    }

    /**
     * PC 프로그램에서 고른 재생목록 파일 하나로 새 테이프를 만들고, 저장 폴더가 있으면 그 바로 아래에 이 앱의 파일로 써 둔다.
     * 곡은 경로 → 파일 이름 → #EXTINF 태그 순으로 폰 컬렉션에서 찾는다 (PC 경로라도 파일 이름·태그로 맞춘다).
     * 돌려주는 것: { ok, id, name, count, saved } 또는 { ok:false, error }
     */
    static synchronized JSONObject importFile(App app, String fileName, byte[] raw) throws Exception {
        if (!app.library.isScanned()) return new JSONObject().put("ok", false).put("error", "폰이 아직 라이브러리를 읽고 있어요");
        String text = PlaylistImport.readText(new java.io.ByteArrayInputStream(raw));
        if (text == null) return new JSONObject().put("ok", false).put("error", "파일을 읽지 못했어요");
        List<String> items = PlaylistImport.parseTapeText(text, app.library.all());
        if (items.isEmpty()) return new JSONObject().put("ok", false).put("error", "폰 컬렉션에서 맞는 곡을 찾지 못했어요");
        String name = stripExt(fileName == null ? "" : fileName.replace('\\', '/').substring(fileName.replace('\\', '/').lastIndexOf('/') + 1)).trim();
        if (name.isEmpty()) name = "가져온 테이프";
        JSONObject pl = app.db.createPlaylist(name, new JSONArray(items));
        String id = pl.getString("id");
        JSONObject out = new JSONObject().put("ok", true).put("id", id).put("name", name).put("count", items.size()).put("saved", false);

        String dir = app.db.get(K_DIR, "");
        if (dir.isEmpty()) return out; // 저장 폴더를 안 골랐으면 테이프만
        try {
            ContentResolver cr = app.getContentResolver();
            Uri tree = Uri.parse(dir);
            String rootDoc = DocumentsContract.getTreeDocumentId(tree);
            Set<String> taken = new HashSet<>();
            try (Cursor c = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootDoc), new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null) while (c.moveToNext()) if (c.getString(0) != null) taken.add(c.getString(0).toLowerCase(Locale.ROOT));
            }
            String base = safe(name), file = base + ".m3u8";
            for (int n = 2; taken.contains(file.toLowerCase(Locale.ROOT)); n++) file = base + " (" + n + ").m3u8";
            String body = content(app, pl); // 이 앱의 형식(#TAPEBOX: 표시)으로 쓴다 → 가져오기·pull이 다시 새 테이프로 보지 않는다
            Uri made = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, rootDoc), MIME, file);
            if (made == null) return out;
            String doc = DocumentsContract.getDocumentId(made);
            try (OutputStream o = cr.openOutputStream(made, "wt")) { if (o != null) o.write(body.getBytes(StandardCharsets.UTF_8)); }
            JSONObject map = new JSONObject(app.db.get(K_MAP, "{}"));
            JSONObject files = map.optJSONObject("files"); if (files == null) files = new JSONObject();
            files.put(id, new JSONObject().put("doc", doc).put("path", "/" + file).put("hash", hash(body)).put("at", System.currentTimeMillis()));
            map.put("files", files);
            app.db.put(K_MAP, map.toString());
            out.put("saved", true).put("file", file);
        } catch (Exception e) { Log.w(TAG, "import write " + name, e); } // 파일은 못 써도 테이프는 남긴다 (다음 저장 때 다시 쓴다)
        return out;
    }

    /** 파일이 있는 폴더에 맞춰 테이프의 상자를 맞춘다. 바뀌면 true */
    private static boolean placeInBox(Db db, String id, String folder, Map<String, String> boxFolder, Set<String> diskFolders) throws Exception {
        String curBox = null;
        JSONArray boxes = db.boxes();
        for (int i = 0; i < boxes.length() && curBox == null; i++) {
            JSONArray its = boxes.getJSONObject(i).optJSONArray("items");
            if (its != null) for (int k = 0; k < its.length(); k++) if (id.equals(its.optString(k))) { curBox = boxes.getJSONObject(i).getString("id"); break; }
        }
        if (folder.isEmpty()) { // 폴더 바로 아래 = 상자 밖
            if (curBox == null) return false;
            JSONObject b = db.box(curBox); JSONArray keep = new JSONArray(), its = b.getJSONArray("items");
            for (int k = 0; k < its.length(); k++) if (!id.equals(its.optString(k))) keep.put(its.get(k));
            db.updateBox(curBox, new JSONObject().put("items", keep));
            return true;
        }
        if (curBox != null && folder.equalsIgnoreCase(boxFolder.get(curBox))) return false; // 이미 그 상자
        for (Map.Entry<String, String> en : boxFolder.entrySet()) if (folder.equalsIgnoreCase(en.getValue())) { // 그 폴더의 상자로 옮긴다
            JSONObject b = db.box(en.getKey()); JSONArray its = b.getJSONArray("items"); its.put(id);
            db.updateBox(en.getKey(), new JSONObject().put("items", its)); // 다른 상자에서는 저절로 빠진다
            return true;
        }
        // 그 이름의 상자가 없다: 지금 상자의 폴더가 디스크에서 사라졌으면 상자 폴더 이름을 바꾼 것 → 상자 이름을 바꾼다
        if (curBox != null && !diskFolders.contains(String.valueOf(boxFolder.get(curBox)).toLowerCase(Locale.ROOT))) {
            db.updateBox(curBox, new JSONObject().put("name", folder));
            return true;
        }
        db.putInBoxByName(id, folder); // 새 폴더 → 새 상자
        return true;
    }

    static synchronized void sync(App app) throws Exception {
        String dir = app.db.get(K_DIR, "");
        if (dir.isEmpty() || !app.library.isScanned()) return;
        try { if (pull(app)) app.emit("{\"type\":\"library\"}"); } catch (Exception e) { Log.w(TAG, "pull", e); } // 밖에서 고친 것을 먼저 받아 덮어쓰지 않게
        ContentResolver cr = app.getContentResolver();
        Uri tree = Uri.parse(dir);
        String rootDoc = DocumentsContract.getTreeDocumentId(tree);

        // 상자에 든 테이프 → 그 상자의 폴더 이름
        Map<String, String> folderOf = new HashMap<>();
        Set<String> usedFolders = new HashSet<>();
        JSONArray boxes = app.db.boxes();
        Map<String, String> bf = boxFolders(boxes);
        for (int i = 0; i < boxes.length(); i++) {
            JSONObject bx = boxes.getJSONObject(i);
            String f = bf.get(bx.getString("id"));
            usedFolders.add(f.toLowerCase(Locale.ROOT));
            JSONArray its = bx.optJSONArray("items");
            if (its != null) for (int k = 0; k < its.length(); k++) folderOf.putIfAbsent(its.optString(k), f);
        }

        // 저장할 파일: 테이프 id → [폴더, 파일 이름, 내용] (같은 폴더에 이름이 겹치면 뒤에 번호)
        Map<String, String[]> want = new LinkedHashMap<>();
        Map<String, Set<String>> usedNames = new HashMap<>();
        JSONArray pls = app.db.playlists();
        for (int i = 0; i < pls.length(); i++) {
            JSONObject pl = pls.getJSONObject(i);
            String id = pl.getString("id"), folder = folderOf.getOrDefault(id, "");
            Set<String> used = usedNames.computeIfAbsent(folder, x -> new HashSet<>());
            String name = safe(pl.optString("name")), file = name + ".m3u8";
            for (int n = 2; used.contains(file.toLowerCase(Locale.ROOT)); n++) file = name + " (" + n + ").m3u8";
            used.add(file.toLowerCase(Locale.ROOT));
            want.put(id, new String[]{folder, file, content(app, pl)});
        }

        // 히스토리 상자: 달마다 가장 많이 들은 30곡 (시스템 상자와 달리 파일로도 남긴다)
        String histFolder = histFolderName(bf);
        boolean saveHist = hist(app.db);
        JSONArray hist = saveHist ? app.db.monthlyTop(30) : new JSONArray();
        for (int i = 0; i < hist.length(); i++) {
            JSONObject h = hist.getJSONObject(i);
            String month = h.getString("month"); // "2026-11"
            String title = month.substring(0, 4) + ". " + Integer.parseInt(month.substring(5)) + ".";
            JSONObject pl = new JSONObject().put("id", "hist-" + month).put("name", title).put("items", h.getJSONArray("items"));
            want.put("hist-" + month, new String[]{histFolder, safe(title.substring(0, title.length() - 1)) + ".m3u8", content(app, pl)});
        }

        JSONObject map = new JSONObject(app.db.get(K_MAP, "{}"));
        JSONObject dirs = map.optJSONObject("_dirs"); if (dirs == null) dirs = new JSONObject();
        JSONObject files = map.optJSONObject("files"); if (files == null) files = new JSONObject();
        JSONObject next = new JSONObject();

        // 1) 지운 테이프·옮긴(이름이 바뀌거나 상자가 바뀐) 테이프의 옛 파일을 지운다
        for (java.util.Iterator<String> it = files.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject e = files.getJSONObject(id);
            if (!saveHist && id.startsWith("hist-")) { next.put(id, e); continue; }
            String[] w = want.get(id);
            if (w != null && (w[0] + "/" + w[1]).equals(e.optString("path"))) continue;
            delete(cr, tree, e.optString("doc"));
        }
        // 2) 새로 쓰거나, 내용이 바뀐 것만 다시 쓴다
        for (Map.Entry<String, String[]> en : want.entrySet()) {
            String id = en.getKey(), folder = en.getValue()[0], file = en.getValue()[1], text = en.getValue()[2];
            String path = folder + "/" + file, hash = hash(text);
            JSONObject e = files.optJSONObject(id);
            String doc = e != null && path.equals(e.optString("path")) && exists(cr, tree, e.optString("doc")) ? e.optString("doc") : null;
            if (doc != null && hash.equals(e.optString("hash"))) { next.put(id, e); continue; }
            try {
                if (doc == null) {
                    String parent = folder.isEmpty() ? rootDoc : ensureDir(cr, tree, rootDoc, folder, dirs);
                    Uri made = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, parent), MIME, file);
                    if (made == null) continue;
                    doc = DocumentsContract.getDocumentId(made);
                }
                try (OutputStream out = cr.openOutputStream(DocumentsContract.buildDocumentUriUsingTree(tree, doc), "wt")) {
                    if (out != null) out.write(text.getBytes(StandardCharsets.UTF_8));
                }
                next.put(id, new JSONObject().put("doc", doc).put("path", path).put("hash", hash).put("at", System.currentTimeMillis()));
            } catch (Exception ex) { Log.w(TAG, "write " + path, ex); }
        }
        // 3) 이 앱이 만든 상자 폴더 중 이제 쓰지 않고 비어 있는 것은 지운다
        Set<String> wantFolders = new HashSet<>();
        for (String[] w : want.values()) if (!w[0].isEmpty()) wantFolders.add(w[0]);
        JSONObject nextDirs = new JSONObject();
        for (java.util.Iterator<String> it = dirs.keys(); it.hasNext(); ) {
            String f = it.next(), d = dirs.optString(f);
            if (wantFolders.contains(f) && exists(cr, tree, d)) nextDirs.put(f, d);
            else if (!wantFolders.contains(f) && isEmptyDir(cr, tree, d)) delete(cr, tree, d);
        }
        app.db.put(K_MAP, new JSONObject().put("files", next).put("_dirs", nextDirs).toString());
    }

    private static String ensureDir(ContentResolver cr, Uri tree, String rootDoc, String name, JSONObject dirs) throws Exception {
        String d = dirs.optString(name, "");
        if (!d.isEmpty() && exists(cr, tree, d)) return d;
        // 같은 이름의 폴더가 이미 있으면 그걸 쓴다
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootDoc);
        try (Cursor c = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c != null) while (c.moveToNext())
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)) && name.equalsIgnoreCase(c.getString(1))) { d = c.getString(0); dirs.put(name, d); return d; }
        }
        Uri made = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, rootDoc), DocumentsContract.Document.MIME_TYPE_DIR, name);
        if (made == null) throw new IllegalStateException("mkdir " + name);
        d = DocumentsContract.getDocumentId(made);
        dirs.put(name, d);
        return d;
    }

    private static boolean exists(ContentResolver cr, Uri tree, String doc) {
        if (doc == null || doc.isEmpty()) return false;
        try (Cursor c = cr.query(DocumentsContract.buildDocumentUriUsingTree(tree, doc), new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
            return c != null && c.moveToFirst();
        } catch (Exception e) { return false; }
    }

    private static boolean isEmptyDir(ContentResolver cr, Uri tree, String doc) {
        if (!exists(cr, tree, doc)) return false;
        try (Cursor c = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, doc), new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
            return c != null && c.getCount() == 0;
        } catch (Exception e) { return false; }
    }

    private static void delete(ContentResolver cr, Uri tree, String doc) {
        if (doc == null || doc.isEmpty()) return;
        try { DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, doc)); } catch (Exception ignored) {} // 이미 없으면 그만
    }
}
