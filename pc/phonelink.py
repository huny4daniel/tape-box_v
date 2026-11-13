"""폰과 PC 사이의 https 연결

폰 앱은 PC 접속을 https(TLS_PORT)로만 받는다. 인증서는 폰이 직접 만든 것(자체 서명)이라 보통의 인증서 검사는 통과하지 못하므로,
처음 붙은 폰의 인증서 지문(SHA-256)을 기억해 두고 그 뒤로는 지문이 같은 폰에만 붙는다 (지문이 다르면 거절).

창(WebView2)은 폰에 직접 붙지 않고 이 PC 안의 작은 중계 서버(127.0.0.1)에 붙는다.
중계 서버가 요청을 지문을 확인한 https 연결로 폰에 넘기므로, 창은 인증서 경고를 볼 일이 없고
네트워크로 나가는 내용은 모두 암호화된다. 창의 주소가 폰 IP와 상관없이 늘 같아 쿠키(짝 맺은 기록)도 유지된다.
"""
import hashlib
import http.client
import http.server
import json
import socket
import ssl
import threading

# 중계 서버가 폰에 넘기지 않는 헤더 (연결마다 따로 정하는 것들)
HOP = {"connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade",
       "proxy-authorization", "proxy-authenticate", "host"}
_CTX = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE  # 체인 검사 대신 아래에서 지문을 직접 비교한다


class CertMismatch(Exception):
    """폰의 인증서가 기억해 둔 것과 다르다 (다른 기기가 폰인 척하거나, 폰 앱을 새로 깔았거나)"""

    def __init__(self, fp):
        super().__init__(fp)
        self.fp = fp


def connect(host, port, expect=None, timeout=10):
    """폰에 https로 붙는다. expect(지문)가 있으면 다를 때 CertMismatch. → (연결, 지문)"""
    c = http.client.HTTPSConnection(host, port, timeout=timeout, context=_CTX)
    c.connect()
    fp = hashlib.sha256(c.sock.getpeercert(binary_form=True)).hexdigest()
    if expect and fp != expect:
        c.close()
        raise CertMismatch(fp)
    return c, fp


def check(host, port, timeout=2):
    """host가 폰 앱이면 ("ready" | "off", 지문), 아니면 (None, None). "off"는 「PC에서 접속」이 꺼진 상태"""
    try:
        c, fp = connect(host, port, timeout=timeout)
    except Exception:
        return None, None
    try:
        c.request("GET", "/api/status")
        r = c.getresponse()
        body = r.read().decode("utf-8", "replace")
    except Exception:
        return None, None
    finally:
        c.close()
    if r.status == 200:
        try:
            o = json.loads(body)
        except ValueError:
            return None, None
        return ("ready", fp) if isinstance(o, dict) and "authorized" in o and "count" in o else (None, None)
    if r.status == 403 and "PC에서 접속" in body:
        return "off", fp
    return None, None


def short_fp(fp):
    """사람이 폰 화면과 맞춰 보기 쉬운 앞 16자리 (ABCD 1234 …)"""
    s = (fp or "")[:16].upper()
    return " ".join(s[i:i + 4] for i in range(0, len(s), 4))


class Relay:
    """창 → (http, 127.0.0.1) → 이 중계 서버 → (https, 지문 확인) → 폰"""

    def __init__(self, port):
        self.target = None  # (host, port, 지문)
        self._idle = []     # 다시 쓸 폰 연결 (요청마다 TLS 악수를 새로 하지 않게)
        self._lock = threading.Lock()
        try:
            self.server = http.server.ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        except OSError:  # 그 포트를 다른 프로그램이 쓰고 있다 → 아무 포트나 (이번 실행만 쿠키를 새로 받게 된다)
            self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.server.daemon_threads = True
        self.server.relay = self
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def set_target(self, host, port, fp):
        with self._lock:
            self.target = (host, port, fp)
            idle, self._idle = self._idle, []
        for c, _ in idle:
            c.close()

    def _get(self):
        """(연결, 다시 쓰는 연결인지)"""
        with self._lock:
            tgt = self.target
            while self._idle:
                c, t = self._idle.pop()
                if t == tgt:
                    return c, True, tgt
                c.close()
        if not tgt:
            raise ConnectionError("no phone")
        c, _ = connect(tgt[0], tgt[1], expect=tgt[2], timeout=60)
        return c, False, tgt

    def _put(self, c, tgt):
        with self._lock:
            if tgt == self.target and len(self._idle) < 8:
                self._idle.append((c, tgt))
                return
        c.close()

    def close(self):
        self.server.shutdown()


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _fail(self, code, msg):
        data = json.dumps({"error": msg}, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _forward(self):
        relay = self.server.relay
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        r = c = tgt = None
        for attempt in range(2):  # 쉬던 연결을 폰이 이미 닫았으면 새 연결로 한 번 더
            try:
                c, reused, tgt = relay._get()
            except CertMismatch:
                return self._fail(502, "폰의 인증서가 달라요. PC 프로그램을 다시 열어 주세요")
            except Exception:
                return self._fail(502, "폰에 닿지 않아요")
            try:
                c.request(self.command, self.path, body=body, headers=headers)
                r = c.getresponse()
                break
            except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                c.close()
                if not reused or attempt:
                    return self._fail(502, "폰에 닿지 않아요")
            except Exception:
                c.close()
                return self._fail(502, "폰에 닿지 않아요")
        keep = False
        try:
            self.send_response(r.status, r.reason)
            for k, v in r.getheaders():
                if k.lower() not in HOP and k.lower() != "content-length":
                    self.send_header(k, v)
            if r.getheader("Content-Length") is None:  # 길이를 모르는 응답은 다 받아서 길이를 붙인다
                data = r.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)
            else:
                self.send_header("Content-Length", r.getheader("Content-Length"))
                self.end_headers()
                while chunk := r.read(65536):
                    self.wfile.write(chunk)
            keep = not r.will_close
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            self.close_connection = True  # 창이 음원 탐색 중에 끊은 경우 (폰 연결은 응답이 남아 있어 버린다)
        except Exception:
            self.close_connection = True
        finally:
            if keep:
                relay._put(c, tgt)
            else:
                c.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _forward
