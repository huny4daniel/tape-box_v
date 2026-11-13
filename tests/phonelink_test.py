"""PC ↔ 폰 https 연결 시험 (pc/phonelink.py)
가짜 폰(자체 서명 https 서버)을 띄워: 폰 알아보기, 인증서 지문 확인, 중계 서버로 주고받기(쿠키·POST·길이 없는 응답·연결 재사용)를 본다.
인증서는 openssl로 만든다 (없으면 건너뜀).

    python tests/phonelink_test.py
"""
import hashlib
import http.client
import http.server
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pc"))
import phonelink  # noqa: E402


def make_cert(d, name):
    key, crt = os.path.join(d, name + ".key"), os.path.join(d, name + ".crt")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
                    "-keyout", key, "-out", crt, "-days", "2", "-subj", "/CN=Tape Box"],
                   check=True, capture_output=True)
    with open(crt) as f:
        der = ssl.PEM_cert_to_DER_cert(f.read())
    return key, crt, hashlib.sha256(der).hexdigest()


class Phone(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    remote_on = True
    conns = set()

    def log_message(self, *a):
        pass

    def setup(self):
        super().setup()
        Phone.conns.add(id(self.connection))

    def _send(self, code, body, ctype="application/json", length=True, extra=()):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in extra:
            self.send_header(k, v)
        if length:
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:  # 길이 없는 응답 (chunked)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for part in (data[:5], data[5:]):
                self.wfile.write(b"%x\r\n%s\r\n" % (len(part), part))
            self.wfile.write(b"0\r\n\r\n")

    def do_GET(self):
        if self.path == "/api/status":
            if not Phone.remote_on:
                return self._send(403, "폰 앱에서 「PC에서 접속」을 켜 주세요.", "text/plain; charset=utf-8")
            return self._send(200, json.dumps({"authorized": "mc_token=t1" in (self.headers.get("Cookie") or ""), "count": 3}))
        if self.path == "/chunked":
            return self._send(200, "hello chunked world", "text/plain", length=False)
        self._send(404, "{}")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        if self.path == "/api/pair":
            return self._send(200, "{}", extra=[("Set-Cookie", "mc_token=t1; Path=/; HttpOnly"), ("Set-Cookie", "other=x; Path=/")])
        self._send(200, json.dumps({"echo": body.decode("utf-8")}))


def serve(key, crt):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Phone)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    srv.daemon_threads = True
    srv.handle_error = lambda *a: None  # 중계가 쉬던 연결을 닫을 때 나는 끊김 로그는 시험과 상관없다
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def get(url_port, method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", url_port, timeout=5)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r, data


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if not shutil.which("openssl"):
        print("openssl이 없어 건너뜀")
        return
    d = tempfile.mkdtemp()
    key, crt, fp = make_cert(d, "phone")
    key2, crt2, fp2 = make_cert(d, "fake")
    phone, fake = serve(key, crt), serve(key2, crt2)
    pport, fport = phone.server_address[1], fake.server_address[1]

    # 폰 알아보기: 상태와 지문
    assert phonelink.check("127.0.0.1", pport) == ("ready", fp), phonelink.check("127.0.0.1", pport)
    Phone.remote_on = False
    assert phonelink.check("127.0.0.1", pport) == ("off", fp)
    Phone.remote_on = True
    assert phonelink.check("127.0.0.1", 1) == (None, None)  # 아무도 없는 포트
    print("  ok  폰 알아보기 (ready / off / 없음) + 인증서 지문")

    # 지문 확인
    try:
        phonelink.connect("127.0.0.1", fport, expect=fp)
        raise AssertionError("지문이 다른데 붙었음")
    except phonelink.CertMismatch as e:
        assert e.fp == fp2
    print("  ok  지문이 다른 기기는 거절")

    relay = phonelink.Relay(0)
    rport = relay.server.server_address[1]
    r, _ = get(rport, "GET", "/api/status")
    assert r.status == 502, "폰을 정하기 전에는 502"
    relay.set_target("127.0.0.1", pport, fp)

    r, data = get(rport, "POST", "/api/pair", body=b'{"pin":"1"}', headers={"Content-Type": "application/json"})
    cookies = r.headers.get_all("Set-Cookie")
    assert r.status == 200 and len(cookies) == 2 and cookies[0].startswith("mc_token=t1"), cookies
    r, data = get(rport, "GET", "/api/status", headers={"Cookie": "mc_token=t1"})
    assert json.loads(data)["authorized"] is True
    print("  ok  중계: 쿠키 두 개 그대로 받고, 보낸 쿠키가 폰에 닿음")

    r, data = get(rport, "POST", "/echo", body="한글 본문".encode("utf-8"), headers={"Content-Type": "text/plain"})
    assert json.loads(data)["echo"] == "한글 본문"
    r, data = get(rport, "GET", "/chunked")
    assert data == b"hello chunked world" and r.headers["Content-Length"] == str(len(data))
    print("  ok  중계: POST 본문, 길이 없는 응답")

    Phone.conns.clear()
    for _ in range(10):
        get(rport, "GET", "/api/status")
    assert len(Phone.conns) <= 2, f"폰 연결을 다시 쓰지 않음: {len(Phone.conns)}개"
    print(f"  ok  중계: 요청 10번에 새 폰 연결 {len(Phone.conns)}개 (쉬던 연결 재사용)")

    # 폰(NanoHTTPD)은 쉬는 연결을 몇 초 뒤 닫는다. 그 뒤에 온 요청(예: PIN 입력)도 새 연결로 받아야 한다
    Phone.timeout = 0.5
    get(rport, "GET", "/api/status")
    import time
    time.sleep(1.5)
    r, data = get(rport, "POST", "/echo", body=b"pin", headers={"Content-Type": "text/plain"})
    assert r.status == 200 and json.loads(data)["echo"] == "pin", (r.status, data)
    Phone.timeout = None
    print("  ok  중계: 폰이 닫은 쉬던 연결 뒤의 요청도 전달")

    # 폰이 연결을 끊어도 다시 붙는다
    phone.shutdown(); phone.server_close()
    phone = serve(key, crt)
    relay.set_target("127.0.0.1", phone.server_address[1], fp)
    r, _ = get(rport, "GET", "/api/status")
    assert r.status == 200
    # 같은 주소에서 다른 인증서로 바뀌면 거절
    relay.set_target("127.0.0.1", fport, fp)
    r, data = get(rport, "GET", "/api/status")
    assert r.status == 502 and "인증서" in json.loads(data)["error"]
    print("  ok  중계: 인증서가 바뀐 폰에는 넘기지 않음")
    relay.close()
    print("PC ↔ 폰 https 연결 시험 통과")


if __name__ == "__main__":
    main()
