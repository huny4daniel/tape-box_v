package io.github.huny4daniel.musiccollection;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.util.Log;
import android.util.Size;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

/** 앨범아트: mp3에 들어 있는 그림을 꺼내 크기별 JPEG로 캐시한다. */
public class ArtCache {
    private static final String TAG = "ArtCache";
    private static final int[] SIZES = {96, 300, 640};
    private final Context ctx;
    private final Library lib;
    private final File dir;
    private final Semaphore gate = new Semaphore(3); // 동시에 꺼내는 개수 제한
    private final ConcurrentHashMap<String, Object> locks = new ConcurrentHashMap<>();

    public ArtCache(Context ctx, Library lib) {
        this.ctx = ctx.getApplicationContext();
        this.lib = lib;
        this.dir = new File(ctx.getCacheDir(), "art");
        dir.mkdirs();
    }

    public static int bucket(int s) { for (int b : SIZES) if (s <= b) return b; return SIZES[SIZES.length - 1]; }

    /** 캐시 파일. 그림이 없으면 null */
    public File get(String albumKey, int req) {
        int size = bucket(req);
        String name = albumKey.replaceAll("[^A-Za-z0-9_-]", "_") + "_" + size;
        File f = new File(dir, name + ".jpg"), none = new File(dir, albumKey.replaceAll("[^A-Za-z0-9_-]", "_") + ".none");
        if (f.exists()) return f;
        if (none.exists()) return null;
        Object lock = locks.computeIfAbsent(name, k -> new Object());
        synchronized (lock) {
            if (f.exists()) return f;
            Track t = lib.albumRep(albumKey);
            if (t == null) return null;
            try {
                gate.acquire();
                Bitmap bm = extract(t, size);
                if (bm == null) { none.createNewFile(); return null; }
                File tmp = new File(dir, name + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { bm.compress(Bitmap.CompressFormat.JPEG, size <= 96 ? 80 : 88, out); }
                bm.recycle();
                if (!tmp.renameTo(f)) return null;
                return f;
            } catch (Exception e) {
                Log.w(TAG, "art failed " + albumKey, e);
                return null;
            } finally {
                gate.release();
                locks.remove(name);
            }
        }
    }

    private Bitmap extract(Track t, int size) {
        byte[] pic = null;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, t.uri());
            pic = r.getEmbeddedPicture();
        } catch (Exception e) {
            Log.w(TAG, "retriever", e);
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
        Bitmap src = null;
        if (pic != null) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(pic, 0, pic.length, o);
            int s = 1;
            while (Math.min(o.outWidth, o.outHeight) / (s * 2) >= size) s *= 2;
            o.inJustDecodeBounds = false; o.inSampleSize = s;
            src = BitmapFactory.decodeByteArray(pic, 0, pic.length, o);
        }
        if (src == null) {
            try { src = ctx.getContentResolver().loadThumbnail(t.uri(), new Size(size, size), null); } catch (Exception ignored) {}
        }
        if (src == null) return null;
        // 가운데를 정사각형으로 잘라 크기 맞추기
        int w = src.getWidth(), h = src.getHeight(), m = Math.min(w, h);
        Bitmap sq = Bitmap.createBitmap(src, (w - m) / 2, (h - m) / 2, m, m);
        int out = Math.min(size, m);
        Bitmap res = Bitmap.createScaledBitmap(sq, out, out, true);
        if (sq != src) src.recycle();
        if (res != sq) sq.recycle();
        return res;
    }

    public void clear() {
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }
}
