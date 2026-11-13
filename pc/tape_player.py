"""테이프 박스 (PC)

같은 Wi-Fi에 있는 폰 앱을 찾아 그 화면을 창 하나로 띄운다.
- 지난번에 붙었던 주소를 먼저 확인하고, 없으면 PC가 붙어 있는 네트워크를 훑어 8644 포트(https)를 연 폰을 찾는다.
- 폰과는 https로만 주고받는다. 처음 붙은 폰의 인증서 지문을 기억해 두고, 지문이 다른 기기에는 붙지 않는다 (phonelink.py).
- 창(WebView2)의 쿠키를 저장해 두므로 PIN은 처음 한 번만 넣으면 된다. PIN 입력 화면은 폰이 내려주는 화면이 그대로 띄운다.
- 폰 화면의 「설정 · 연결」에서 싱크 가사 생성기(lyricsync.py)를 설치하고 돌릴 수 있게 js_api를 연다.
"""
import asyncio
import base64
import ipaddress
import json
import os
import socket
import sys
import threading
import time


def _unblock_bundle():
    """배포 zip을 탐색기로 풀면 모든 파일에 '인터넷에서 받음' 표시(Zone.Identifier)가 붙는다.
    .NET Framework는 그런 DLL(pythonnet의 Python.Runtime.dll 등)을 거부해 창이 뜨지 못하므로,
    webview를 불러오기 전에 실행 폴더 안 파일의 표시를 지운다."""
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return
    for dirpath, _, files in os.walk(os.path.dirname(sys.executable)):
        for name in files:
            try:
                os.remove(os.path.join(dirpath, name) + ":Zone.Identifier")
            except OSError:
                pass


_unblock_bundle()

import psutil  # noqa: E402
import webview  # noqa: E402

import phonelink  # noqa: E402
from app_version import VERSION  # noqa: E402

from lyricsync import LyricSync

# --debug: 폰의 디버그 앱(포트 8643)에 붙는다. 원래 앱과 짝 맺은 쿠키·지난 주소를 섞지 않게 따로 둔다
DEBUG = "--debug" in sys.argv[1:]
APP_TITLE = "테이프 박스 (디버그)" if DEBUG else "테이프 박스"
PORT = 8645 if DEBUG else 8644        # 폰의 PC 접속용 https 포트 (WebServer.TLS_PORT)
RELAY_PORT = 8663 if DEBUG else 8662  # 창이 붙는 이 PC 안의 중계 서버 (늘 같은 주소라야 쿠키가 유지된다)
HOST_KEY = "host_debug" if DEBUG else "host"
FP_KEY = "cert_debug" if DEBUG else "cert"  # 처음 붙은 폰의 인증서 지문
DATA_DIR = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "tape-player")
CONFIG = os.path.join(DATA_DIR, "config.json")
PENDING = os.path.join(DATA_DIR, "pending_playlists_debug.json" if DEBUG else "pending_playlists.json")  # 폰에 아직 못 보낸 재생목록 파일
PENDING_MAX = 2 * 1024 * 1024  # 재생목록 파일 하나의 상한 (폰 서버가 받는 요청 크기 안에 들게)

CONNECT_TIMEOUT = 0.6   # 포트 하나 두드려 보는 시간
CONCURRENCY = 384       # 한꺼번에 두드리는 수
MAX_HOSTS = 8192        # 네트워크가 아주 넓을 때 훑는 상한
VIRTUAL_IF = ("vethernet", "vmware", "virtualbox", "hyper-v", "wsl", "docker")  # 폰이 있을 리 없는 가상 어댑터


# ───── 설정 ─────
def load_config():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False)


# ───── 폰 알아보기 ─────
def check(host):
    """host가 폰 앱이면 ("ready" | "off", 인증서 지문), 아니면 (None, None). "off"는 「PC에서 접속」이 꺼진 상태"""
    return phonelink.check(host, PORT)


def candidate_hosts():
    """PC가 붙어 있는 사설 네트워크의 주소들. PC 자신의 주소와 가까운 순서로"""
    own, items = set(), []
    stats = psutil.net_if_stats()
    for name, addrs in psutil.net_if_addrs().items():
        st = stats.get(name)
        if (st is not None and not st.isup) or any(k in name.lower() for k in VIRTUAL_IF):
            continue
        for a in addrs:
            if a.family != socket.AF_INET or not a.netmask:
                continue
            ip = ipaddress.IPv4Address(a.address)
            if not ip.is_private or ip.is_loopback or ip.is_link_local:
                continue
            own.add(ip)
            net = ipaddress.IPv4Network(f"{a.address}/{a.netmask}", strict=False)
            if net.prefixlen < 20:  # 너무 넓은 네트워크는 PC 주변만
                net = ipaddress.IPv4Network(f"{a.address}/22", strict=False)
            for h in net.hosts():
                items.append((abs(int(h) - int(ip)), h))
    items.sort(key=lambda x: x[0])
    seen, out = set(), []
    for _, h in items:
        if h in own or h in seen:
            continue
        seen.add(h)
        out.append(str(h))
        if len(out) >= MAX_HOSTS:
            break
    return out


async def _scan(hosts, want=None):
    """폰을 찾는다. want(기억해 둔 지문)가 있으면 그 폰을 먼저, 끝까지 없으면 지문이 다른 폰이라도 돌려준다"""
    sem = asyncio.Semaphore(CONCURRENCY)
    loop = asyncio.get_running_loop()

    async def probe(h):
        async with sem:
            try:
                _, w = await asyncio.wait_for(asyncio.open_connection(h, PORT), CONNECT_TIMEOUT)
                w.close()
            except Exception:
                return None
            state, fp = await loop.run_in_executor(None, check, h)
            return (h, state, fp) if state else None

    tasks = [asyncio.create_task(probe(h)) for h in hosts]
    other = None
    try:
        for fut in asyncio.as_completed(tasks):
            r = await fut
            if r and (not want or r[2] == want):
                return r
            other = other or r
        return other or (None, None, None)
    finally:
        for t in tasks:
            t.cancel()


def scan(want=None):
    hosts = candidate_hosts()
    if not hosts:
        return None, None, None
    return asyncio.run(_scan(hosts, want))


# ───── 창 ─────
STATUS_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0d0c0b;color:#f4efe8;font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;text-align:center}
.box{max-width:420px;padding:24px}
h1{font-size:22px;margin:0 0 18px;letter-spacing:-.02em}
.reel{width:44px;height:44px;margin:0 auto 22px;border-radius:50%;border:3px solid #2c2824;border-top-color:#e8b25a;animation:spin 1.1s linear infinite}
.reel.stop{animation:none;border-top-color:#2c2824}
p{margin:0;color:#b3aba1;line-height:1.6;font-size:14px}
small{display:block;margin-top:10px;color:#7d756c;font-size:12px}
button{margin-top:20px;padding:10px 18px;border:0;border-radius:8px;background:#e8b25a;color:#1a1206;font:inherit;font-weight:700;cursor:pointer}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="box"><div class="reel" id="reel"></div><h1>테이프 박스</h1>
<p id="msg">폰을 찾고 있어요…</p><small id="sub"></small><button id="act" hidden onclick="this.hidden=true;pywebview.api.trust_phone()"></button></div>
<script>
function setStatus(msg, sub, busy, act){document.getElementById('msg').textContent=msg;document.getElementById('sub').textContent=sub||'';document.getElementById('reel').className='reel'+(busy?'':' stop');var b=document.getElementById('act');b.textContent=act||'';b.hidden=!act;}
</script></body></html>"""


class Finder:
    def __init__(self, window, relay):
        self.window = window
        self.relay = relay
        self.trust = threading.Event()  # 인증서가 바뀐 폰을 믿겠다고 눌렀다

    def status(self, msg, sub="", busy=True, act=""):
        try:
            self.window.evaluate_js(f"setStatus({json.dumps(msg)}, {json.dumps(sub)}, {json.dumps(busy)}, {json.dumps(act)})")
        except Exception:
            pass

    def run(self):
        cfg = load_config()
        while True:
            host, state, fp = None, None, None
            pinned = cfg.get(FP_KEY)
            saved = cfg.get(HOST_KEY)
            if saved:
                self.status("폰에 연결하고 있어요…", saved)
                state, fp = check(saved)
                if state and (not pinned or fp == pinned):
                    host = saved
            if not host:
                self.status("같은 Wi-Fi에서 폰을 찾고 있어요…", "처음에는 몇 초 걸릴 수 있어요")
                host, state, fp = scan(pinned)

            if state and pinned and fp != pinned:
                # 지난번 폰과 인증서가 다르다: 폰 앱을 새로 깔았거나, 같은 네트워크의 다른 기기가 폰인 척하는 것
                self.trust.clear()
                self.status("폰의 보안 인증서가 바뀌었어요",
                            f"폰 앱을 다시 설치했다면 폰의 설정 · 연결에 나온 인증서가 {phonelink.short_fp(fp)} 인지 확인하고 눌러 주세요. "
                            "아니라면 누르지 마세요 (공용 Wi-Fi라면 다른 기기가 폰인 척하는 것일 수 있어요)",
                            busy=False, act="이 폰을 믿기")
                if self.trust.wait(20):
                    cfg[FP_KEY] = fp
                    save_config(cfg)
                continue

            if state == "off":
                self.status("폰 앱에서 「PC에서 접속」을 켜 주세요",
                            "라이브러리 → 설정 · 연결 · 켜지면 자동으로 연결돼요", busy=False)
                while state == "off":
                    time.sleep(2)
                    state, fp2 = check(host)
                    if state and fp2 != fp:
                        state = None  # 그새 다른 기기로 바뀌었다 → 처음부터
                        break

            if state == "ready":
                cfg[HOST_KEY] = host
                cfg[FP_KEY] = fp  # 처음 붙은 폰이면 지금 기억한다
                save_config(cfg)
                self.relay.set_target(host, PORT, fp)
                self.window.load_url(self.relay.url)
                return

            if state is None and host:
                continue
            self.status("폰을 찾지 못했어요",
                        "폰과 PC가 같은 Wi-Fi에 있는지, 폰 앱이 켜져 있는지 확인해 주세요 · 다시 찾는 중", busy=False)
            time.sleep(3)


class Api:
    """폰 화면(설정 · 연결)이 window.pywebview.api로 부르는 PC 쪽 기능. 재생목록 추가하기와 싱크 가사 생성기"""

    def __init__(self):
        self._window = None
        self._finder = None
        self._ls = LyricSync(load_config, save_config)

    def app_version(self):
        """PC 프로그램 버전 (설정 화면). 소스로 돌리면 None"""
        return VERSION

    def trust_phone(self):
        """인증서가 바뀐 폰을 믿는다 (연결 화면의 버튼)"""
        if self._finder:
            self._finder.trust.set()

    # ── 재생목록 추가하기: 고른 파일을 PENDING에 들고 있다가, 폰 화면이 하나씩 받아 폰에 보내고 끝난 것만 지운다 ──
    def _pending(self):
        try:
            with open(PENDING, encoding="utf-8") as f:
                items = json.load(f)
            return items if isinstance(items, list) else []
        except Exception:
            return []

    def _save_pending(self, items):
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = PENDING + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False)
        os.replace(tmp, PENDING)

    def pl_pick(self):
        """파일 탐색기에서 재생목록 파일을 여러 개 고른다 → 보낼 목록에 더한다"""
        kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
        r = self._window.create_file_dialog(kind, allow_multiple=True,
                                            file_types=("재생목록 (*.m3u;*.m3u8)", "모든 파일 (*.*)"))
        if not r:
            return {"ok": False, "cancel": True}
        paths = [r] if isinstance(r, str) else list(r)
        items = self._pending()
        errors = []
        for p in paths:
            try:
                if os.path.getsize(p) > PENDING_MAX:
                    errors.append(f"{os.path.basename(p)}: 파일이 너무 커요")
                    continue
                with open(p, "rb") as f:
                    data = base64.b64encode(f.read()).decode("ascii")
            except OSError as e:
                errors.append(f"{os.path.basename(p)}: {e.strerror or e}")
                continue
            key = os.path.normcase(p)
            items = [x for x in items if os.path.normcase(x.get("src", "")) != key]  # 같은 파일을 또 고르면 새 내용으로
            items.append({"src": p, "name": os.path.basename(p), "data": data})
        self._save_pending(items)
        return {"ok": True, "added": len(paths) - len(errors), "errors": errors, "pending": len(items)}

    def pl_pending(self):
        """보낼 차례인 파일들 (내용 포함)"""
        return self._pending()

    def pl_done(self, srcs):
        """폰이 받은(또는 받을 수 없는) 파일을 목록에서 뺀다"""
        drop = {os.path.normcase(s) for s in (srcs or [])}
        items = [x for x in self._pending() if os.path.normcase(x.get("src", "")) not in drop]
        self._save_pending(items)
        return {"ok": True, "pending": len(items)}

    def ls_state(self):
        return self._ls.state()

    def _pick_folder(self):
        kind = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
        r = self._window.create_file_dialog(kind)
        if not r:
            return None
        return r[0] if isinstance(r, (list, tuple)) else r

    def ls_pick_dir(self):
        p = self._pick_folder()
        return self._ls.set_parent(p) if p else {"ok": False, "cancel": True}

    def ls_pick_music(self):
        p = self._pick_folder()
        return self._ls.set_music_dir(p) if p else {"ok": False, "cancel": True}

    def ls_set_source(self, source):
        return self._ls.set_source(source)

    def ls_send(self, server, token):
        return self._ls.start_send(server, token)

    def ls_reset(self, server, token):
        return self._ls.reset(server, token)

    def ls_install(self):
        return self._ls.install()

    def ls_remove(self):
        return self._ls.remove()

    def ls_start(self, server, token):
        return self._ls.start(server, token)

    def ls_review(self, server, token, ids, action):
        return self._ls.review(server, token, ids, action)

    def ls_sync(self, server, token):
        return self._ls.sync_rejected(server, token)

    def ls_results(self, kind):
        return self._ls.results(kind)

    def ls_stop(self):
        return self._ls.stop()


def icon_path():
    """창·작업 표시줄 아이콘 (exe로 묶으면 _MEIPASS/assets, 소스로 돌리면 pc/assets)"""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(base, "assets", "tape-box.ico")
    return p if os.path.isfile(p) else None


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.name == "nt":
        # 작업 표시줄이 python(w).exe 아이콘으로 묶지 않고 이 프로그램 아이콘을 쓰게 따로 이름을 붙인다
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("TapeBox.PC" + (".Debug" if DEBUG else ""))
        except Exception:
            pass
    api = Api()
    window = webview.create_window(APP_TITLE, html=STATUS_HTML, width=1280, height=820,
                                   min_size=(720, 520), background_color="#0d0c0b", js_api=api)
    api._window = window
    relay = phonelink.Relay(RELAY_PORT)
    finder = Finder(window, relay)
    api._finder = finder
    # 쿠키(짝 맺은 기록)를 남기려면 private_mode를 꺼야 한다
    webview.start(lambda: threading.Thread(target=finder.run, daemon=True).start(),
                  private_mode=False, storage_path=os.path.join(DATA_DIR, "webview-debug" if DEBUG else "webview"),
                  icon=icon_path())


if __name__ == "__main__":
    main()
