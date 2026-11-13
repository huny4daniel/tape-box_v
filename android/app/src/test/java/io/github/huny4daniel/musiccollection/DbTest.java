package io.github.huny4daniel.musiccollection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import androidx.test.core.app.ApplicationProvider;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

/**
 * 폰 DB 규칙 시험: 화면이 무엇을 보내든 DB가 지키는 것들.
 *
 *     android> gradlew testDebugUnitTest
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, application = android.app.Application.class) // App(서버를 띄움) 대신 빈 Application
public class DbTest {
    private Db db;

    @Before public void open() {
        android.content.Context c = ApplicationProvider.getApplicationContext();
        c.deleteDatabase("collection.db");
        db = new Db(c);
    }

    @After public void close() { db.close(); }

    private static JSONArray arr(String... s) { JSONArray a = new JSONArray(); for (String x : s) a.put(x); return a; }

    private static List<String> list(JSONArray a) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    private String boxOf(String plId) throws Exception {
        String found = null;
        JSONArray all = db.boxes();
        for (int i = 0; i < all.length(); i++) {
            if (list(all.getJSONObject(i).getJSONArray("items")).contains(plId)) {
                assertNull("테이프가 두 상자에 들어 있음: " + plId, found);
                found = all.getJSONObject(i).getString("name");
            }
        }
        return found;
    }

    @Test public void 상자에는_내가_만든_테이프만_한번씩() throws Exception {
        String p1 = db.createPlaylist("하나", arr()).getString("id");
        JSONObject b = db.createBox("상자", arr(p1, "liked", "top", "hist-2026-10", "tmp-1", "없는id", p1));
        assertEquals(List.of(p1), list(b.getJSONArray("items")));
    }

    @Test public void 다른_상자에_넣으면_원래_상자에서_빠진다() throws Exception {
        String p1 = db.createPlaylist("하나", arr()).getString("id");
        String p2 = db.createPlaylist("둘", arr()).getString("id");
        JSONObject a = db.createBox("가", arr(p1, p2));
        JSONObject b = db.createBox("나", arr(p1));
        assertEquals("나", boxOf(p1));
        assertEquals(List.of(p2), list(db.box(a.getString("id")).getJSONArray("items")));

        db.updateBox(a.getString("id"), new JSONObject().put("items", arr(p2, p1)));
        assertEquals("가", boxOf(p1));
        assertEquals(List.of(), list(db.box(b.getString("id")).getJSONArray("items")));
        assertEquals("순서는 보낸 그대로", List.of(p2, p1), list(db.box(a.getString("id")).getJSONArray("items")));
    }

    @Test public void 상자_이름만_바꾸면_테이프는_그대로() throws Exception {
        String p1 = db.createPlaylist("하나", arr()).getString("id");
        String id = db.createBox("가", arr(p1)).getString("id");
        JSONObject b = db.updateBox(id, new JSONObject().put("name", "새 이름"));
        assertEquals("새 이름", b.getString("name"));
        assertEquals(List.of(p1), list(b.getJSONArray("items")));
        assertNull("없는 상자", db.updateBox("없음", new JSONObject().put("name", "x")));
    }

    @Test public void 테이프를_지우면_상자에서도_빠진다() throws Exception {
        String p1 = db.createPlaylist("하나", arr()).getString("id");
        String p2 = db.createPlaylist("둘", arr()).getString("id");
        String b = db.createBox("가", arr(p1, p2)).getString("id");
        db.deletePlaylist(p1);
        assertEquals(List.of(p2), list(db.box(b).getJSONArray("items")));
    }

    @Test public void 이름으로_상자에_넣기() throws Exception {
        String p1 = db.createPlaylist("하나", arr()).getString("id");
        db.putInBoxByName(p1, "가");
        assertEquals("가", boxOf(p1));
        db.putInBoxByName(p1, "나");
        assertEquals("나", boxOf(p1));
        db.putInBoxByName(p1, "나");
        assertEquals(1, db.box(db.boxes().getJSONObject(1).getString("id")).getJSONArray("items").length());
    }

    @Test public void 화면_상태_합치기() throws Exception {
        db.mergePrefs(new JSONObject("{\"tapePlayed\":{\"p1\":1},\"libSort\":{\"albums\":\"recent\"},\"col\":{\"sort\":\"new\"}}"));
        JSONObject p = db.mergePrefs(new JSONObject("{\"tapePlayed\":{\"p2\":2},\"libSort\":{\"albums\":null,\"artists\":\"plays\"},\"col\":null}"));
        assertEquals(1, p.getJSONObject("tapePlayed").getInt("p1"));
        assertEquals(2, p.getJSONObject("tapePlayed").getInt("p2"));
        assertFalse(p.getJSONObject("libSort").has("albums"));
        assertEquals("plays", p.getJSONObject("libSort").getString("artists"));
        assertFalse(p.has("col"));
        assertEquals(p.toString(), db.prefs().toString());
    }

    @Test public void 최근_들은_기록_초기화는_최근_들은_테이프도_지운다() throws Exception {
        db.mergePrefs(new JSONObject("{\"tapePlayed\":{\"p1\":1},\"boxHidden\":{\"sys\":true}}"));
        db.resetRecords(false, false, false);
        assertTrue(db.prefs().has("tapePlayed"));
        db.resetRecords(false, false, true);
        assertFalse(db.prefs().has("tapePlayed"));
        assertTrue("다른 화면 상태는 그대로", db.prefs().getJSONObject("boxHidden").getBoolean("sys"));
    }

    @Test public void 히스토리는_달마다_많이_들은_30곡() throws Exception {
        List<Track> ts = new ArrayList<>();
        for (int i = 0; i < 35; i++) { Track t = new Track(); t.id = "t" + i; t.addedAt = i; ts.add(t); }
        db.assignNumbers(ts);
        for (int i = 0; i < 35; i++) for (int k = 0; k <= i; k++) db.recordPlay("t" + i, 30000, true); // t34가 가장 많이
        db.recordPlay("t0", 1000, false); // 다 듣지 않은 재생은 세지 않는다
        JSONArray h = db.monthlyTop(30);
        assertEquals(1, h.length());
        List<String> items = list(h.getJSONObject(0).getJSONArray("items"));
        assertEquals(30, items.size());
        assertEquals("t34", items.get(0));
        assertEquals("t5", items.get(29));
        assertFalse(items.contains("t0"));

        db.resetRecords(true, false, false);
        assertEquals("들은 횟수를 지우면 히스토리도", 0, db.monthlyTop(30).length());
    }
}
