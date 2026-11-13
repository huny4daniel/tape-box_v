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

    static synchronized void sync(App app) throws Exception {
        String dir = app.db.get(K_DIR, "");
        if (dir.isEmpty() || !app.library.isScanned()) return;
        ContentResolver cr = app.getContentResolver();
        Uri tree = Uri.parse(dir);
        String rootDoc = DocumentsContract.getTreeDocumentId(tree);

        // 상자에 든 테이프 → 그 상자의 폴더 이름 (상자 이름이 겹치면 뒤에 번호)
        Map<String, String> folderOf = new HashMap<>();
        Set<String> usedFolders = new HashSet<>();
        JSONArray boxes = app.db.boxes();
        for (int i = 0; i < boxes.length(); i++) {
            JSONObject bx = boxes.getJSONObject(i);
            String f = safe(bx.optString("name")), base = f;
            for (int n = 2; usedFolders.contains(f.toLowerCase(Locale.ROOT)); n++) f = base + " (" + n + ")";
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
        String histFolder = "히스토리 상자", base = histFolder;
        for (int n = 2; usedFolders.contains(histFolder.toLowerCase(Locale.ROOT)); n++) histFolder = base + " (" + n + ")";
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
            String path = folder + "/" + file, hash = Integer.toHexString(text.hashCode());
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
                next.put(id, new JSONObject().put("doc", doc).put("path", path).put("hash", hash));
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
