package io.github.huny4daniel.musiccollection;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 셔플 상태. 대기열 순서 자체를 섞는 방식이라 원래 순서(orig)를 함께 기억한다.
 * 화면(웹)과 홈 화면 위젯 양쪽에서 바꿀 수 있어서, 둘이 같은 값을 보도록 여기 한 곳에 둔다.
 */
final class Shuffle {
    private static Boolean on = null;
    private static String orig = "[]";

    private Shuffle() {}

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("playback", Context.MODE_PRIVATE); }

    private static void load(Context c) {
        if (on != null) return;
        SharedPreferences p = prefs(c);
        on = p.getBoolean("shuffle", false);
        orig = p.getString("shuffleOrig", "[]");
    }

    static synchronized boolean on(Context c) { load(c); return on; }
    static synchronized String orig(Context c) { load(c); return orig; }

    static void set(Context c, boolean value, String origJson) {
        synchronized (Shuffle.class) {
            on = value;
            orig = value && origJson != null ? origJson : "[]";
            prefs(c).edit().putBoolean("shuffle", on).putString("shuffleOrig", orig).apply();
        }
        TapeWidget.refresh(c.getApplicationContext(), false);
    }
}
