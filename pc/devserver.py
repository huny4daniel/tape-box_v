"""개발용 서버 — 실행하면 PC 브라우저와 폰 앱이 같은 저장소 화면 파일을 쓴다.

    dev.bat 더블클릭 (또는 python pc/devserver.py)

- PC 브라우저: http://localhost:8655 를 자동으로 연다. 화면 파일은 저장소에서, /api/는 USB로 이은 폰에서 가져온다
  (adb forward로 붙으므로 폰은 같은 기기 요청으로 보고 PIN·「PC에서 접속」 없이 받는다)
- 폰 디버그 앱: adb reverse로 이 서버에서 화면 파일을 가져온다. 앱이 없거나 폰 앱 소스(Java 등)가
  마지막 설치 이후 바뀌었으면 시작할 때 빌드해서 설치한다 (앱 데이터 유지)
- 화면(js/boot.js의 devWatch)이 /__dev/wait 로 바뀐 파일을 기다린다: css만 바뀌면 스타일만 갈아 끼우고, 나머지는 다시 읽는다
- 127.0.0.1에만 열어 두므로 같은 Wi-Fi의 다른 기기에서는 닿지 않는다
"""
import http.client
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEV_PORT = 8655  # WebServer.java의 DEV_PORT와 같아야 한다
PHONE_PORT = 8643  # 디버그 앱 내장 서버
PKG = "io.github.huny4daniel.musiccollection.debug"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
STAMP = os.path.join(ANDROID, "app", "build", "dev-installed.txt")  # 마지막으로 설치한 소스 시각 (build/는 git 제외)
WATCH = ("index.html", "css", "js")
HOP = {"host", "connection", "keep-alive", "transfer-encoding", "accept-encoding", "te", "upgrade"}
SERIAL = []  # adb -s <기기>


# ───── adb·빌드 ─────
def find_sdk():
    cands = []
    lp = os.path.join(ANDROID, "local.properties")
    if os.path.exists(lp):
        for line in open(lp, encoding="utf-8"):
            if line.startswith("sdk.dir="):
                cands.append(line.split("=", 1)[1].strip().replace("\\:", ":").replace("\\\\", "\\"))
    cands += [os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")]
    for sdk in filter(None, cands):
        if os.path.exists(os.path.join(sdk, "platform-tools")):
            return sdk
    return None


def find_adb():
    sdk = find_sdk()
    return os.path.join(sdk, "platform-tools", "adb.exe" if os.name == "nt" else "adb") if sdk else "adb"


ADB = find_adb()


def adb(*args, timeout=120):
    try:
        r = subprocess.run([ADB, *SERIAL, *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 1, str(e)


def source_stamp():
    """폰 앱 소스(웹 파일 제외)의 마지막 수정 시각"""
    files = [os.path.join(ANDROID, f) for f in ("build.gradle.kts", "settings.gradle.kts", "gradle.properties", os.path.join("app", "build.gradle.kts"))]
    for d, _, fs in os.walk(os.path.join(ANDROID, "app", "src")):
        files += [os.path.join(d, f) for f in fs]
    return max((os.path.getmtime(f) for f in files if os.path.exists(f)), default=0)


def installed_stamp():
    try:
        with open(STAMP) as f:
            return float(f.read().strip())
    except Exception:
        return -1


def build_and_install():
    """디버그 앱을 빌드해 폰에 설치한다 (앱 데이터는 유지). 실패하면 안내 문구를 돌려준다."""
    stamp = source_stamp()
    print("[dev] 폰 앱 빌드 중… (처음엔 몇 분 걸릴 수 있어요)")
    env = dict(os.environ)
    sdk = find_sdk()
    if sdk:
        env["ANDROID_HOME"] = sdk
    gradlew = os.path.join(ANDROID, "gradlew.bat" if os.name == "nt" else "gradlew")
    if subprocess.run([gradlew, "assembleDebug", "-q"], cwd=ANDROID, env=env).returncode:
        return "폰 앱 빌드에 실패했어요. 위 오류를 확인해 주세요."
    print("[dev] 폰에 설치 중… (무선 디버깅이면 조금 걸려요)")
    apk = os.path.join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
    code, out = adb("install", "-r", apk, timeout=600)
    if code and ("INSTALL_FAILED_UPDATE_INCOMPATIBLE" in out or "signatures do not match" in out):
        # 다른 PC에서 만든 디버그 앱이 깔려 있으면 서명이 달라 덮어쓸 수 없다 → 지우고 다시
        print("[dev] 서명이 다른 디버그 앱이 있어 지우고 다시 설치해요 (디버그 앱의 기록은 지워져요)")
        adb("uninstall", PKG, timeout=120)
        code, out = adb("install", apk, timeout=600)
    if code or not app_installed():
        return "폰에 설치하지 못했어요: " + out.strip()[-300:]
    print("[dev] 설치했어요")
    with open(STAMP, "w") as f:
        f.write(str(stamp))
    return None


def app_installed():
    return PKG in adb("shell", "pm", "list", "packages", PKG)[1]


def start_app():
    adb("reverse", f"tcp:{DEV_PORT}", f"tcp:{DEV_PORT}")
    adb("forward", f"tcp:{PHONE_PORT}", f"tcp:{PHONE_PORT}")
    adb("shell", "am", "force-stop", PKG)
    adb("shell", "am", "start", "-n", f"{PKG}/io.github.huny4daniel.musiccollection.MainActivity")


def watch_install():
    """켜 두는 동안 폰에서 디버그 앱이 지워지면 다시 빌드해 깔고 띄운다 (15초마다 확인)"""
    while True:
        time.sleep(15)
        try:
            code, out = adb("devices")
            if code or not any(l.endswith("	device") for l in out.splitlines()) or app_installed():
                continue
            print("[dev] 폰에 디버그 앱이 없어 다시 설치해요")
            err = build_and_install()
            if err: print("[dev] ※ " + err); continue
            start_app(); print("[dev] 디버그 앱을 다시 띄웠어요")
        except Exception as e:
            print("[dev] ※ 설치 확인 중 오류:", e)


def setup_phone():
    """폰과 포트를 잇고 디버그 앱을 새로 띄운다. 문제가 있으면 안내 문구를 돌려준다."""
    code, out = adb("devices")
    devs = [l.split("\t")[0] for l in out.splitlines() if l.endswith("\tdevice")]
    if code or not devs:
        return "폰이 adb로 연결돼 있지 않아요. USB 디버깅을 켜고 연결한 뒤 다시 실행해 주세요."
    SERIAL[:] = ["-s", devs[0]]  # 같은 폰이 무선 주소와 mDNS 이름으로 두 번 잡혀도 하나로
    # 앱이 없거나 Java 등 폰 앱 소스가 마지막 설치 이후 바뀌었으면 빌드해서 설치
    if not app_installed() or source_stamp() > installed_stamp():
        err = build_and_install()
        if err:
            return err
    # 이미 떠 있던 앱은 APK 사본 화면을 쓰고 있으니 다시 띄워 이 서버의 화면을 읽게 한다
    start_app()
    for _ in range(20):
        try:
            c = http.client.HTTPConnection("127.0.0.1", PHONE_PORT, timeout=2)
            c.request("GET", "/api/status")
            ok = c.getresponse().status < 500
            c.close()
            if ok:
                return None
        except Exception:
            pass
        time.sleep(0.5)
    return "폰 앱 서버에 닿지 않아요. 폰에서 디버그 앱이 열렸는지 확인해 주세요."


# ───── 서버 ─────
def version():
    """'그 밖의 파일 시각:css 시각'"""
    page = css = 0.0
    for name in WATCH:
        p = os.path.join(ROOT, name)
        files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs]
        for f in files:
            m = os.path.getmtime(f)
            if f.endswith(".css"):
                css = max(css, m)
            else:
                page = max(page, m)
    return f"{page}:{css}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _wait(self):
        """롱 폴링: 받은 판(v)과 달라질 때까지 최대 25초 기다린다 (폰 서버의 읽기 제한 30초 안)"""
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        old = next((x[2:] for x in q.split("&") if x.startswith("v=")), "")
        deadline = time.time() + 25
        while True:
            cur = version()
            if not old or cur != old or time.time() > deadline:
                # 앞부분(css 밖의 파일 시각)이 그대로면 css만 바뀐 것
                return {"v": cur, "css": bool(old) and old.split(":")[0] == cur.split(":")[0]}
            time.sleep(0.4)

    def _proxy(self):
        """/api/ 요청을 adb forward로 이은 폰 앱에 그대로 넘긴다 (음원 Range 요청 포함)"""
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        try:
            c = http.client.HTTPConnection("127.0.0.1", PHONE_PORT, timeout=60)
            c.request(self.command, self.path, body=body, headers=headers)
            r = c.getresponse()
        except Exception:
            return self.send_error(502, "phone not reachable (USB/adb)")
        try:
            self.send_response(r.status, r.reason)
            for k, v in r.getheaders():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            if r.getheader("Content-Length") is None:
                data = r.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.end_headers()
                while chunk := r.read(65536):
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # 브라우저가 음원 탐색 중에 끊은 경우
        finally:
            c.close()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            return self._proxy()
        if path == "/__dev/wait":
            return self._send(json.dumps(self._wait()).encode(), "application/json")
        if path in ("/", "/index.html"):
            with open(os.path.join(ROOT, "index.html"), "rb") as f:
                return self._send(f.read(), "text/html; charset=utf-8")
        # 내장 글꼴은 폰 앱 assets/fonts에 있다 (폰 내장 서버와 같은 경로로 내준다)
        if path.startswith("/fonts/") and ".." not in path:
            f = os.path.join(ANDROID, "app", "src", "main", "assets", "fonts", os.path.basename(path))
            if os.path.isfile(f):
                with open(f, "rb") as fh:
                    return self._send(fh.read(), "font/woff2" if f.endswith(".woff2") else "font/ttf")
            return self.send_error(404)
        # 화면 파일만 내준다 (저장소의 다른 파일은 숨김)
        if not (path.startswith("/css/") or path.startswith("/js/")):
            return self.send_error(404)
        return super().do_GET()

    def _api_only(self):
        if self.path.startswith("/api/"):
            return self._proxy()
        self.send_error(404)

    do_POST = do_PUT = do_DELETE = _api_only

    def log_message(self, fmt, *args):
        line = fmt % args
        if "/__dev/wait" not in line:
            sys.stderr.write("[dev] " + line + "\n")


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", DEV_PORT), Handler)
    srv.daemon_threads = True
    print(f"[dev] 저장소: {ROOT}")
    msg = setup_phone()
    if msg:
        print("[dev] ※ " + msg)
    else:
        print("[dev] 폰 연결됨 — 폰 앱도 이 서버의 화면 파일을 쓴다")
    threading.Thread(target=watch_install, daemon=True).start()
    url = f"http://localhost:{DEV_PORT}/"
    print(f"[dev] PC 화면: {url}  (파일을 저장하면 양쪽이 새로고침, 끝내려면 이 창을 닫기)")
    webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
