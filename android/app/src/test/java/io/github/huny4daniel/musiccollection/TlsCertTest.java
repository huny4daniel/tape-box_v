package io.github.huny4daniel.musiccollection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * PC 접속용 자체 서명 인증서: 만들고, 다시 읽고, 실제로 TLS 연결이 되는지.
 *
 *     android> gradlew testDebugUnitTest
 */
public class TlsCertTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void createsValidCertAndKeepsItAcrossLoads() throws Exception {
        File dir = new File(tmp.getRoot(), "tls");
        TlsCert a = TlsCert.loadOrCreate(dir);
        a.certificate().checkValidity();
        a.certificate().verify(a.certificate().getPublicKey()); // 자기 서명이 맞다
        assertEquals(64, a.fingerprint().length());
        TlsCert b = TlsCert.loadOrCreate(dir);
        assertEquals("다시 읽어도 같은 인증서", a.fingerprint(), b.fingerprint());
    }

    @Test public void brokenFilesAreReplaced() throws Exception {
        File dir = new File(tmp.getRoot(), "tls");
        String first = TlsCert.loadOrCreate(dir).fingerprint();
        java.nio.file.Files.write(new File(dir, "tls.crt").toPath(), new byte[]{1, 2, 3});
        assertNotEquals(first, TlsCert.loadOrCreate(dir).fingerprint());
    }

    @Test public void tlsHandshakePresentsTheSameCert() throws Exception {
        TlsCert c = TlsCert.loadOrCreate(new File(tmp.getRoot(), "tls"));
        try (SSLServerSocket ss = (SSLServerSocket) c.serverSocketFactory().createServerSocket(0)) {
            ss.setSoTimeout(10_000);
            Thread t = new Thread(() -> {
                try (SSLSocket s = (SSLSocket) ss.accept()) {
                    s.setSoTimeout(10_000);
                    s.startHandshake();
                    s.getOutputStream().write('k'); s.getOutputStream().flush();
                    // 클라이언트가 닫을 때까지 읽고 나서 닫는다. 안 읽은 데이터(TLS 마무리 기록 등)를 남긴 채 닫으면
                    // 운영체제가 연결을 강제로 끊어(RST) 클라이언트가 'k'를 못 받을 수 있다
                    while (s.getInputStream().read() != -1) { }
                } catch (Exception ignored) {}
            });
            t.start();
            // PC 프로그램처럼: 인증서 체인은 검사하지 않고, 받은 인증서 지문만 비교한다
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] x, String a) {}
                public void checkServerTrusted(X509Certificate[] x, String a) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }}, null);
            try (SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket("127.0.0.1", ss.getLocalPort())) {
                s.setSoTimeout(10_000);
                s.startHandshake();
                byte[] der = s.getSession().getPeerCertificates()[0].getEncoded();
                assertEquals(c.fingerprint(), TlsCert.hex(MessageDigest.getInstance("SHA-256").digest(der)));
                assertEquals("암호화된 연결로 서버가 보낸 바이트가 온다", 'k', s.getInputStream().read());
            }
            t.join(5000);
        }
    }
}
