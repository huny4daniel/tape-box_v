package io.github.huny4daniel.musiccollection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * PC·폰 재생 동기화 규칙 (NowSync): 소리를 내는 기기는 하나, 재생을 누른 기기가 넘겨받고, 다른 기기의 조작은 그쪽으로 간다.
 * (폰 재생 서비스는 띄우지 않으므로 폰으로 넘기는 조작은 아무 일도 하지 않는다)
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, application = android.app.Application.class)
public class NowSyncTest {
    private static JSONObject st(boolean playing, long pos) throws Exception {
        return new JSONObject().put("ids", new JSONArray().put("a").put("b")).put("index", 0).put("pos", pos).put("playing", playing).put("dur", 200_000);
    }

    @Test public void phoneTakesEmptySeatButPcMustClaim() throws Exception {
        NowSync n = new NowSync();
        assertFalse("PC는 재생을 누르기 전엔 알릴 수 없다", n.publish("pc-1", st(false, 0)));
        assertTrue("아무도 없으면 폰이 맡는다", n.publish(NowSync.PHONE, st(false, 5000)));
        assertEquals(NowSync.PHONE, n.snapshot().getString("owner"));
    }

    @Test public void claimMovesSoundAndFreezesPosition() throws Exception {
        NowSync n = new NowSync();
        n.publish(NowSync.PHONE, st(true, 10_000));
        n.claim("pc-1", null);
        JSONObject s = n.snapshot();
        assertEquals("pc-1", s.getString("owner"));
        assertFalse("넘겨받는 순간엔 멈춘 상태 (넘겨받은 기기가 재생을 알린다)", s.getBoolean("playing"));
        assertTrue(s.getLong("pos") >= 10_000);
        assertFalse("넘겨준 기기는 더 알릴 수 없다", n.publish(NowSync.PHONE, st(true, 0)));
    }

    @Test public void commandsQueueForPcOwnerOnly() throws Exception {
        NowSync n = new NowSync();
        n.claim("pc-1", st(true, 0));
        n.command(NowSync.PHONE, new JSONObject().put("cmd", "pause"));
        n.command(NowSync.PHONE, new JSONObject().put("cmd", "seek").put("ms", 42_000));
        n.command("pc-1", new JSONObject().put("cmd", "next")); // 소리 내는 기기 자신의 조작은 받지 않는다
        JSONObject s = n.snapshot();
        assertFalse("멈춤은 바로 보인다", s.getBoolean("playing"));
        assertEquals(42_000, s.getLong("pos"));
        assertEquals(2, s.getJSONArray("cmds").length());
        assertEquals(2, s.getLong("cmdSeq"));
        n.claim(NowSync.PHONE, null);
        assertEquals("넘겨받으면 밀린 조작은 버린다", 0, n.snapshot().getJSONArray("cmds").length());
    }

    @Test public void metaFromOtherDeviceIsMarked() throws Exception {
        NowSync n = new NowSync();
        n.claim("pc-1", st(true, 0));
        n.command(NowSync.PHONE, new JSONObject().put("cmd", "sync").put("ids", new JSONArray().put("b").put("a")).put("index", 1)
                .put("meta", new JSONObject().put("shuffle", true).put("orig", new JSONArray().put("a").put("b"))));
        JSONObject s = n.snapshot();
        assertTrue(s.getBoolean("shuffle"));
        assertEquals(NowSync.PHONE, s.getString("metaBy"));
        assertEquals("b", s.getJSONArray("ids").getString(0));
    }

    @Test public void awaitReturnsOnChange() throws Exception {
        NowSync n = new NowSync();
        long v = n.snapshot().getLong("ver");
        new Thread(() -> { try { Thread.sleep(100); n.publish(NowSync.PHONE, st(true, 0)); } catch (Exception ignored) {} }).start();
        long t0 = System.currentTimeMillis();
        JSONObject s = n.await(v, 5000);
        assertTrue("바뀌면 바로 답한다", System.currentTimeMillis() - t0 < 3000);
        assertTrue(s.getLong("ver") > v);
    }
}
