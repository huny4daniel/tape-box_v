package io.github.huny4daniel.musiccollection;

import org.json.JSONArray;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/**
 * 라이브러리에 넣을 폴더 고르기. 폴더는 MediaStore의 RELATIVE_PATH("Music/앨범/") 그대로 쓴다.
 * - off: 사용자가 끈 폴더 (정확히 그 폴더만. 하위 폴더는 화면에서 함께 끈다)
 * - known: 마지막으로 저장할 때 있던 폴더들
 * - 처음 보는 폴더는 가장 가까운 상위의 아는 폴더를 따르고, 그런 폴더가 없으면 autoNew를 따른다
 */
public class FolderFilter {
    private static final String K_OFF = "folders_off", K_KNOWN = "folders_known", K_AUTO = "folders_auto_new";

    final Set<String> off, known;
    final boolean autoNew;

    private FolderFilter(Set<String> off, Set<String> known, boolean autoNew) {
        this.off = off; this.known = known; this.autoNew = autoNew;
    }

    static FolderFilter load(Db db) {
        return new FolderFilter(set(db.get(K_OFF, "[]")), set(db.get(K_KNOWN, "[]")), !"0".equals(db.get(K_AUTO, "1")));
    }

    static void save(Db db, Collection<String> off, Collection<String> known, boolean autoNew) {
        db.put(K_OFF, new JSONArray(off).toString());
        db.put(K_KNOWN, new JSONArray(known).toString());
        db.put(K_AUTO, autoNew ? "1" : "0");
    }

    boolean includes(String folder) {
        if (known.contains(folder)) return !off.contains(folder);
        for (String p = parent(folder); p != null; p = parent(p)) {
            if (known.contains(p)) return !off.contains(p);
        }
        return autoNew;
    }

    /** "Music/A/B/" → "Music/A/", "Music/" → null */
    static String parent(String folder) {
        String f = folder.endsWith("/") ? folder.substring(0, folder.length() - 1) : folder;
        int i = f.lastIndexOf('/');
        return i < 0 ? null : f.substring(0, i + 1);
    }

    static String norm(String relPath) {
        if (relPath == null || relPath.isEmpty()) return "/";
        return relPath.endsWith("/") ? relPath : relPath + "/";
    }

    private static Set<String> set(String json) {
        Set<String> out = new HashSet<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (Exception ignored) {}
        return out;
    }
}
