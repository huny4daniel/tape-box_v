package io.github.huny4daniel.musiccollection;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * mp3의 ID3v2 태그에서 가사를 읽는다.
 *  - SYLT(시간이 붙은 가사) 프레임
 *  - USLT(일반 가사) 프레임. 안에 [mm:ss.xx] 형식 시간이 있으면 시간 가사로 바꾼다 (멜론 파일이 이 형식)
 */
public class Id3Lyrics {
    private static final String TAG = "Id3Lyrics";
    private static final Charset MS949 = charset("MS949");

    public static class Line {
        public final long ms; public final String text;
        Line(long ms, String text) { this.ms = ms; this.text = text; }
    }
    public static class Result { public List<Line> synced; public String plain; }

    private static Charset charset(String n) { try { return Charset.forName(n); } catch (Exception e) { return StandardCharsets.ISO_8859_1; } }

    public static Result read(Context ctx, Uri uri) {
        Result res = new Result();
        try (InputStream raw = ctx.getContentResolver().openInputStream(uri)) {
            if (raw == null) return res;
            DataInputStream in = new DataInputStream(raw);
            byte[] h = new byte[10];
            in.readFully(h);
            if (h[0] != 'I' || h[1] != 'D' || h[2] != '3') return res;
            int ver = h[3];
            int flags = h[5] & 0xff;
            int size = syncsafe(h, 6);
            if (size <= 0 || size > 64 * 1024 * 1024) return res;
            byte[] tag = new byte[size];
            in.readFully(tag);
            if (ver < 4 && (flags & 0x80) != 0) tag = unsync(tag, 0, tag.length);
            int p = 0;
            if ((flags & 0x40) != 0) { // 확장 헤더 건너뛰기
                int ext = ver >= 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4;
                p = ext;
            }
            String uslt = null;
            List<Line> sylt = null;
            while (p + 10 <= tag.length) {
                if (tag[p] == 0) break; // 패딩
                String id = new String(tag, p, 4, StandardCharsets.ISO_8859_1);
                int fsz = ver >= 4 ? syncsafe(tag, p + 4) : be32(tag, p + 4);
                int fflags = ((tag[p + 8] & 0xff) << 8) | (tag[p + 9] & 0xff);
                int start = p + 10;
                if (fsz <= 0 || start + fsz > tag.length) break;
                if (id.equals("USLT") || id.equals("SYLT")) {
                    byte[] body = java.util.Arrays.copyOfRange(tag, start, start + fsz);
                    if (ver >= 4) {
                        int off = 0;
                        if ((fflags & 0x0001) != 0) off = 4;            // 데이터 길이 표시
                        if ((fflags & 0x0002) != 0) body = unsync(body, off, body.length - off);
                        else if (off > 0) body = java.util.Arrays.copyOfRange(body, off, body.length);
                    }
                    if (id.equals("USLT") && uslt == null) uslt = parseUslt(body);
                    if (id.equals("SYLT") && sylt == null) sylt = parseSylt(body);
                }
                p = start + fsz;
            }
            if (sylt != null && !sylt.isEmpty()) res.synced = sylt;
            else if (uslt != null) {
                List<Line> lrc = parseLrc(uslt);
                if (lrc != null) res.synced = lrc; else res.plain = uslt;
            }
        } catch (Exception e) {
            Log.w(TAG, "read failed: " + uri, e);
        }
        return res;
    }

    private static int syncsafe(byte[] b, int o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
    private static int be32(byte[] b, int o) { return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff); }
    private static byte[] unsync(byte[] b, int off, int len) {
        ByteArrayOutputStream o = new ByteArrayOutputStream(len);
        for (int i = off; i < off + len; i++) {
            o.write(b[i]);
            if ((b[i] & 0xff) == 0xff && i + 1 < off + len && b[i + 1] == 0) i++;
        }
        return o.toByteArray();
    }

    /** enc 형식으로 쓰인 0으로 끝나는 문자열을 읽는다. [끝 위치, 문자열] */
    private static Object[] readStr(byte[] b, int p, int enc) {
        boolean wide = enc == 1 || enc == 2;
        int end = p;
        if (wide) { while (end + 1 < b.length && !(b[end] == 0 && b[end + 1] == 0)) end += 2; }
        else { while (end < b.length && b[end] != 0) end++; }
        String s = decode(b, p, Math.min(end, b.length) - p, enc);
        int next = Math.min(b.length, end + (wide ? 2 : 1));
        return new Object[]{next, s};
    }

    private static String decode(byte[] b, int p, int len, int enc) {
        if (len <= 0) return "";
        switch (enc) {
            case 1: return new String(b, p, len, StandardCharsets.UTF_16);       // BOM 포함
            case 2: return new String(b, p, len, StandardCharsets.UTF_16BE);
            case 3: return new String(b, p, len, StandardCharsets.UTF_8);
            default: {
                // 규격상 ISO-8859-1이지만 한국 파일은 CP949로 쓴 경우가 많다
                boolean high = false;
                for (int i = p; i < p + len; i++) if ((b[i] & 0x80) != 0) { high = true; break; }
                return new String(b, p, len, high ? MS949 : StandardCharsets.ISO_8859_1);
            }
        }
    }

    private static String parseUslt(byte[] b) {
        if (b.length < 5) return null;
        int enc = b[0];
        Object[] desc = readStr(b, 4, enc); // 언어 3바이트 다음 설명
        int p = (int) desc[0];
        String text = decode(b, p, b.length - p, enc);
        int z = text.indexOf('\u0000');
        if (z >= 0) text = text.substring(0, z);
        return text.replace("\r\n", "\n").replace('\r', '\n');
    }

    private static List<Line> parseSylt(byte[] b) {
        if (b.length < 7) return null;
        int enc = b[0];
        int fmt = b[4]; // 2 = 밀리초
        if (fmt != 2) return null;
        Object[] desc = readStr(b, 6, enc);
        int p = (int) desc[0];
        List<Line> out = new ArrayList<>();
        while (p < b.length) {
            Object[] s = readStr(b, p, enc);
            p = (int) s[0];
            if (p + 4 > b.length) break;
            long ms = be32(b, p) & 0xffffffffL;
            p += 4;
            String text = ((String) s[1]).replace("\n", "").replace("\r", "");
            out.add(new Line(ms, text));
        }
        out.sort((x, y) -> Long.compare(x.ms, y.ms));
        return out;
    }

    private static final Pattern TIME = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern OFFSET = Pattern.compile("\\[offset:\\s*([+-]?\\d+)\\]", Pattern.CASE_INSENSITIVE);

    /** LRC 형식이면 시간 가사로, 아니면 null */
    static List<Line> parseLrc(String text) {
        List<Line> out = new ArrayList<>();
        long offset = 0;
        Matcher om = OFFSET.matcher(text);
        if (om.find()) offset = Long.parseLong(om.group(1));
        int timed = 0, lines = 0;
        for (String line : text.split("\n")) {
            if (line.trim().isEmpty()) continue;
            lines++;
            Matcher m = TIME.matcher(line);
            List<Long> times = new ArrayList<>();
            int last = 0;
            while (m.find() && m.start() == last) {
                long mm = Long.parseLong(m.group(1)), ss = Long.parseLong(m.group(2));
                String f = m.group(3);
                long frac = f == null ? 0 : f.length() == 1 ? Long.parseLong(f) * 100 : f.length() == 2 ? Long.parseLong(f) * 10 : Long.parseLong(f);
                times.add(mm * 60000 + ss * 1000 + frac);
                last = m.end();
            }
            if (times.isEmpty()) continue;
            timed++;
            String lyric = line.substring(last).trim();
            for (long t : times) out.add(new Line(Math.max(0, t - offset), lyric));
        }
        if (timed == 0 || timed < lines / 2) return null;
        out.sort((x, y) -> Long.compare(x.ms, y.ms));
        return out;
    }
}
