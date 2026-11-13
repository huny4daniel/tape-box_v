"""테이프 박스 (PC)

같은 Wi-Fi에 있는 폰 앱을 찾아 그 화면을 창 하나로 띄운다.
- 지난번에 붙었던 주소를 먼저 확인하고, 없으면 PC가 붙어 있는 네트워크를 훑어 8642 포트를 연 폰을 찾는다.
- 창(WebView2)의 쿠키를 저장해 두므로 PIN은 처음 한 번만 넣으면 된다. PIN 입력 화면은 폰이 내려주는 화면이 그대로 띄운다.
- 폰 화면의 「설정 · 연결」에서 싱크 가사 생성기(lyricsync.py)를 설치하고 돌릴 수 있게 js_api를 연다.
"""
import asyncio
import ipaddress
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request


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

from lyricsync import LyricSync

# --debug: 폰의 디버그 앱(포트 8643)에 붙는다. 원래 앱과 짝 맺은 쿠키·지난 주소를 섞지 않게 따로 둔다
DEBUG = "--debug" in sys.argv[1:]
APP_TITLE = "테이프 박스 (디버그)" if DEBUG else "테이프 박스"
PORT = 8643 if DEBUG else 8642
HOST_KEY = "host_debug" if DEBUG else "host"
DATA_DIR = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "tape-player")
CONFIG = os.path.join(DATA_DIR, "config.json")

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
    """host가 폰 앱이면 "ready"(접속 가능) 또는 "off"(「PC에서 접속」이 꺼짐), 아니면 None"""
    try:
        with urllib.request.urlopen(f"http://{host}:{PORT}/api/status", timeout=2) as r:
            o = json.loads(r.read().decode("utf-8"))
            return "ready" if isinstance(o, dict) and "authorized" in o and "count" in o else None
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        return "off" if e.code == 403 and "PC에서 접속" in body else None
    except Exception:
        return None


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


async def _scan(hosts):
    sem = asyncio.Semaphore(CONCURRENCY)
    loop = asyncio.get_running_loop()

    async def probe(h):
        async with sem:
            try:
                _, w = await asyncio.wait_for(asyncio.open_connection(h, PORT), CONNECT_TIMEOUT)
                w.close()
            except Exception:
                return None
            state = await loop.run_in_executor(None, check, h)
            return (h, state) if state else None

    tasks = [asyncio.create_task(probe(h)) for h in hosts]
    try:
        for fut in asyncio.as_completed(tasks):
            r = await fut
            if r:
                return r
        return None, None
    finally:
        for t in tasks:
            t.cancel()


def scan():
    hosts = candidate_hosts()
    if not hosts:
        return None, None
    return asyncio.run(_scan(hosts))


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
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="box"><div class="reel" id="reel"></div><h1>테이프 박스</h1>
<p id="msg">폰을 찾고 있어요…</p><small id="sub"></small></div>
<script>
function setStatus(msg, sub, busy){document.getElementById('msg').textContent=msg;document.getElementById('sub').textContent=sub||'';document.getElementById('reel').className='reel'+(busy?'':' stop');}
</script></body></html>"""


class Finder:
    def __init__(self, window):
        self.window = window

    def status(self, msg, sub="", busy=True):
        try:
            self.window.evaluate_js(f"setStatus({json.dumps(msg)}, {json.dumps(sub)}, {json.dumps(busy)})")
        except Exception:
            pass

    def run(self):
        cfg = load_config()
        while True:
            host, state = None, None
            saved = cfg.get(HOST_KEY)
            if saved:
                self.status("폰에 연결하고 있어요…", saved)
                state = check(saved)
                if state:
                    host = saved
            if not host:
                self.status("같은 Wi-Fi에서 폰을 찾고 있어요…", "처음에는 몇 초 걸릴 수 있어요")
                host, state = scan()

            if state == "off":
                self.status("폰 앱에서 「PC에서 접속」을 켜 주세요",
                            "라이브러리 → 설정 · 연결 · 켜지면 자동으로 연결돼요", busy=False)
                while state == "off":
                    time.sleep(2)
                    state = check(host)

            if state == "ready":
                cfg[HOST_KEY] = host
                save_config(cfg)
                self.window.load_url(f"http://{host}:{PORT}/")
                return

            self.status("폰을 찾지 못했어요",
                        "폰과 PC가 같은 Wi-Fi에 있는지, 폰 앱이 켜져 있는지 확인해 주세요 · 다시 찾는 중", busy=False)
            time.sleep(3)


class Api:
    """폰 화면(설정 · 연결)이 window.pywebview.api로 부르는 PC 쪽 기능. 지금은 싱크 가사 생성기"""

    def __init__(self):
        self._window = None
        self._ls = LyricSync(load_config, save_config)

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


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    api = Api()
    window = webview.create_window(APP_TITLE, html=STATUS_HTML, width=1280, height=820,
                                   min_size=(720, 520), background_color="#0d0c0b", js_api=api)
    api._window = window
    finder = Finder(window)
    # 쿠키(짝 맺은 기록)를 남기려면 private_mode를 꺼야 한다
    webview.start(lambda: threading.Thread(target=finder.run, daemon=True).start(),
                  private_mode=False, storage_path=os.path.join(DATA_DIR, "webview-debug" if DEBUG else "webview"))


if __name__ == "__main__":
    main()
