package io.github.huny4daniel.musiccollection;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocketFactory;

/**
 * PC 접속(https)에 쓰는 이 폰만의 자체 서명 인증서.
 * 처음 한 번 EC P-256 키와 인증서를 만들어 앱 전용 폴더에 두고 계속 쓴다 (앱을 지우면 새로 만들어진다).
 * 공인 인증서가 아니라 브라우저는 처음에 경고를 띄우고, PC 프로그램은 처음 붙은 폰의 인증서 지문을 기억해 확인한다.
 * 별도 라이브러리 없이 X.509 인증서를 DER로 직접 짠다.
 */
public final class TlsCert {
    private final PrivateKey key;
    private final X509Certificate cert;

    private TlsCert(PrivateKey key, X509Certificate cert) { this.key = key; this.cert = cert; }

    /** dir/tls.key, dir/tls.crt 를 읽고, 없거나 깨졌으면 새로 만든다 */
    public static synchronized TlsCert loadOrCreate(File dir) throws Exception {
        File kf = new File(dir, "tls.key"), cf = new File(dir, "tls.crt");
        if (kf.isFile() && cf.isFile()) {
            try {
                PrivateKey k = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(kf.toPath())));
                X509Certificate c = parse(Files.readAllBytes(cf.toPath()));
                c.checkValidity();
                return new TlsCert(k, c);
            } catch (Exception ignored) {} // 깨졌거나 기한이 지났다 → 새로
        }
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        KeyPair kp = g.generateKeyPair();
        byte[] der = selfSigned(kp, "Tape Box");
        X509Certificate c = parse(der);
        dir.mkdirs();
        write(kf, kp.getPrivate().getEncoded());
        write(cf, der);
        return new TlsCert(kp.getPrivate(), c);
    }

    public X509Certificate certificate() { return cert; }

    /** 인증서 DER의 SHA-256 (소문자 16진수, 구분자 없음). PC 프로그램이 기억해 두고 비교한다 */
    public String fingerprint() {
        try { return hex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())); }
        catch (Exception e) { return ""; }
    }

    public SSLServerSocketFactory serverSocketFactory() throws Exception {
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        char[] pw = "tapebox".toCharArray(); // 메모리 안에서만 쓰는 저장소라 비밀번호는 형식일 뿐
        ks.setKeyEntry("tls", key, pw, new Certificate[]{cert});
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, pw);
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), null, null);
        return ctx.getServerSocketFactory();
    }

    // ───── 인증서 짜기 (DER) ─────
    private static final byte[] OID_ECDSA_SHA256 = {0x2a, (byte) 0x86, 0x48, (byte) 0xce, 0x3d, 0x04, 0x03, 0x02}; // 1.2.840.10045.4.3.2
    private static final byte[] OID_CN = {0x55, 0x04, 0x03}; // 2.5.4.3

    static byte[] selfSigned(KeyPair kp, String cn) throws Exception {
        long now = System.currentTimeMillis();
        byte[] serial = new byte[16];
        new SecureRandom().nextBytes(serial);
        serial[0] &= 0x7f; // 양수
        byte[] alg = seq(tlv(0x06, OID_ECDSA_SHA256));
        byte[] name = seq(tlv(0x31, seq(tlv(0x06, OID_CN), tlv(0x0c, cn.getBytes(StandardCharsets.UTF_8)))));
        byte[] validity = seq(time(new Date(now - 24L * 3600_000)), time(new Date(now + 30L * 365 * 24 * 3600_000)));
        byte[] tbs = seq(
                tlv(0xa0, tlv(0x02, new byte[]{2})), // v3
                tlv(0x02, new BigInteger(1, serial).toByteArray()),
                alg, name, validity, name,
                kp.getPublic().getEncoded()); // SubjectPublicKeyInfo 그대로
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign(kp.getPrivate());
        s.update(tbs);
        byte[] sig = s.sign();
        byte[] bits = new byte[sig.length + 1];
        System.arraycopy(sig, 0, bits, 1, sig.length); // 앞의 0: 남는 비트 수
        return seq(tbs, alg, tlv(0x03, bits));
    }

    /** 2049년까지는 UTCTime, 그 뒤는 GeneralizedTime (X.509 규칙) */
    private static byte[] time(Date d) {
        SimpleDateFormat y = new SimpleDateFormat("yyyy", Locale.ROOT);
        y.setTimeZone(TimeZone.getTimeZone("UTC"));
        boolean utc = Integer.parseInt(y.format(d)) < 2050;
        SimpleDateFormat f = new SimpleDateFormat(utc ? "yyMMddHHmmss'Z'" : "yyyyMMddHHmmss'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return tlv(utc ? 0x17 : 0x18, f.format(d).getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] seq(byte[]... parts) { return tlv(0x30, cat(parts)); }

    private static byte[] tlv(int tag, byte[] v) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(tag);
        int n = v.length;
        if (n < 0x80) o.write(n);
        else if (n < 0x100) { o.write(0x81); o.write(n); }
        else if (n < 0x10000) { o.write(0x82); o.write(n >> 8); o.write(n & 0xff); }
        else { o.write(0x83); o.write(n >> 16); o.write((n >> 8) & 0xff); o.write(n & 0xff); }
        o.write(v, 0, v.length);
        return o.toByteArray();
    }

    private static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parts) o.write(p, 0, p.length);
        return o.toByteArray();
    }

    private static X509Certificate parse(byte[] der) throws Exception {
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(der));
    }

    private static void write(File f, byte[] b) throws Exception {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(b); }
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) throw new java.io.IOException("rename " + f); }
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }
}
