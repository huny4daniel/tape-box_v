"""재생 동기화 시험: 창 두 개(서로 다른 기기)를 띄워, 한쪽에서 듣던 곡을 다른 쪽이 비추고 조종하고 넘겨받는지 본다.

    python tests/sync_test.py

- 화면은 ui_smoke.py와 같은 가짜 데이터로 띄우고, /api/now 만 이 파일의 작은 서버(폰의 NowSync와 같은 규칙)가 맡는다
- 폰 쪽 재생 서비스(자바)는 여기서 돌릴 수 없어 PC 창 둘로 시험한다
"""
import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui_smoke  # noqa: E402

# 가짜 데이터 위에서 /api/now 만 진짜 요청으로 (이 파일의 서버로)
REAL_NOW = """<script>
(function () {
  const j = (m, p, b) => fetch(p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
  Object.assign(window.API, {
    now: (ver, wait) => j("GET", "/api/now?ver=" + ver + (wait ? "&wait=1" : "")),
    nowPublish: (b) => j("POST", "/api/now", b),
    nowClaim: (b) => j("POST", "/api/now/claim", b),
    nowCmd: (b) => j("POST", "/api/now/cmd", b),
  });
})();
</script>
"""


class Now:
    """NowSync.java와 같은 규칙 (폰 재생 서비스 부분만 뺐다)"""

    def __init__(self):
        self.cv = threading.Condition()
        self.s = dict(owner="", ids=[], index=-1, pos=0, playing=False, dur=0, repeat="off", ctx=None, shuffle=False, orig=None, metaBy="", metaVer=0)
        self.at = time.time() * 1000
        self.ver = 0
        self.seq = 0
        self.cmds = []

    def _pos(self):
        s = self.s
        p = s["pos"] + (time.time() * 1000 - self.at if s["playing"] else 0)
        return min(p, s["dur"]) if s["dur"] else p

    def snap(self):
        return dict(self.s, pos=self._pos(), ver=self.ver, cmdSeq=self.seq, cmds=list(self.cmds))

    def _bump(self):
        self.ver += 1
        self.cv.notify_all()

    def _take(self, b):
        for k in ("ids", "index", "playing", "dur", "repeat"):
            if k in b:
                self.s[k] = b[k]
        if "pos" in b:
            self.s["pos"] = b["pos"]; self.at = time.time() * 1000
        if b.get("meta"):
            self._meta(b["dev"], b["meta"])

    def _meta(self, dev, m):
        self.s.update(ctx=m.get("ctx"), shuffle=bool(m.get("shuffle")), orig=m.get("orig"), metaBy=dev, metaVer=self.s["metaVer"] + 1)

    def wait(self, since, wait):
        with self.cv:
            end = time.time() + (20 if wait else 0)
            while self.ver <= since and time.time() < end:
                self.cv.wait(max(0.01, end - time.time()))
            return self.snap()

    def publish(self, b):
        with self.cv:
            if self.s["owner"] == b["dev"]:
                self._take(b); self._bump()
            return self.snap()

    def claim(self, b):
        with self.cv:
            if self.s["owner"] != b["dev"]:
                self.s["pos"] = self._pos(); self.at = time.time() * 1000; self.s["playing"] = False; self.cmds = []
            self.s["owner"] = b["dev"]
            self._take(b); self._bump()
            return self.snap()

    def cmd(self, c):
        with self.cv:
            if not self.s["owner"] or self.s["owner"] == c["dev"]:
                return self.snap()
            if c.get("meta"):
                self._meta(c["dev"], c["meta"])
            k = c.get("cmd")
            if k == "pause":
                self.s["pos"] = self._pos(); self.at = time.time() * 1000; self.s["playing"] = False
            elif k == "seek":
                self.s["pos"] = c.get("ms", 0); self.at = time.time() * 1000
            self.seq += 1
            self.cmds = (self.cmds + [dict(c, seq=self.seq)])[-30:]
            self._bump()
            return self.snap()


NOW = Now()


class Handler(ui_smoke.Handler):
    def _json(self, o):
        body = json.dumps(o).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/now"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            return self._json(NOW.wait(int(q.get("ver", ["-1"])[0]), "wait" in q))
        if self.path.split("?")[0] == "/__test__.html":
            with open(os.path.join(ui_smoke.ROOT, "index.html"), encoding="utf-8") as f:
                html = f.read()
            anchor = '<script src="js/api.js"></script>'
            body = html.replace(anchor, anchor + "\n" + ui_smoke.INJECT + REAL_NOW, 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        p = self.path.split("?")[0]
        if p == "/api/now":
            return self._json(NOW.publish(b))
        if p == "/api/now/claim":
            return self._json(NOW.claim(b))
        if p == "/api/now/cmd":
            return self._json(NOW.cmd(b))
        self.send_response(404); self.end_headers()


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/__test__.html"
    fails = []

    def check(name, ok, detail=""):
        if ok:
            print("  ok ", name)
        else:
            fails.append(f"{name}: {detail}")
            print("  ✗  ", name, detail)

    with sync_playwright() as p:
        browser = ui_smoke.launch(p)
        errors = []
        pages = []
        for _ in range(2):  # 저장소가 따로인 창 = 서로 다른 기기
            ctx = browser.new_context(viewport={"width": 1280, "height": 800})
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(base)
            pg.wait_for_selector("#view .page", timeout=15000)
            pages.append(pg)
        a, b = pages
        st = lambda pg: pg.evaluate("({ owner: P.owner, dev: P.dev, id: P.currentId, playing: P.playing, pos: P.pos, remote: P.remoteName, audio: !P.local.audio.paused, q: P.queue.length, shuffle: P.shuffle })")

        # A에서 테이프 재생 → B가 같은 곡·재생 중으로 비춘다 (B는 소리 없음)
        a.evaluate("location.hash = '#/playlist/p1'"); a.wait_for_timeout(300)
        a.click('.actions [data-act="list-play"]'); a.wait_for_timeout(2500)
        sa, sb = st(a), st(b)
        check("A가 소리를 맡음", sa["owner"] == sa["dev"] and sa["audio"], sa)
        check("B가 같은 곡을 비춤", sb["id"] == sa["id"] and sb["playing"] and sb["remote"] == "PC" and not sb["audio"], sb)
        p1 = st(b)["pos"]; b.wait_for_timeout(1500); p2 = st(b)["pos"]
        check("B의 재생 위치가 흐름", p2 > p1 + 800, (p1, p2))
        check("B 재생 버튼 위에 'PC에서 재생 중'", b.evaluate("document.querySelector('#playerbar .pb-play').dataset.remote") == "PC에서 재생 중")
        check("소리 내는 A에는 표시 없음", a.evaluate("document.querySelector('#playerbar .pb-play').dataset.remote") == "")

        # 소리를 내지 않는 B에도 멈춤(⏸) 버튼이 보인다
        # 보이는 재생 버튼 (재생 화면이 열려 있으면 그 안의 큰 버튼, 아니면 아래 재생바)
        btn = lambda pg: "#fullplayer .np-play" if pg.evaluate("!document.querySelector('#fullplayer').hidden") else "#playerbar .pb-play"
        icon = lambda pg: pg.evaluate("s => document.querySelector(s + ' .ic').className", btn(pg))
        check("A·B 모두 멈춤 버튼", "ic-pause" in icon(a) and "ic-pause" in icon(b), (icon(a), icon(b)))

        # B의 멈춤 버튼을 눌러 → A가 멈춘다. 양쪽 다 재생 버튼으로
        b.click(btn(b)); b.wait_for_timeout(1200)
        sa, sb = st(a), st(b)
        check("B의 멈춤으로 A가 멈춤", not sa["playing"] and not sa["audio"] and not sb["playing"], (sa, sb))
        check("A·B 모두 재생 버튼", "ic-play" in icon(a) and "ic-play" in icon(b), (icon(a), icon(b)))

        # B에서 다음 곡 (멈춘 채) → A도 다음 곡, 멈춘 채
        b.evaluate("P.next()"); b.wait_for_timeout(1200)
        sa, sb = st(a), st(b)
        check("B의 다음 곡이 A에 반영 (멈춘 채)", sa["id"] == sb["id"] and not sa["playing"] and not sa["audio"], (sa, sb))

        # B에서 재생 → B가 소리를 넘겨받고 A는 비추기로
        pos_before = st(a)["pos"]
        b.click(btn(b)); b.wait_for_timeout(2000)
        sa, sb = st(a), st(b)
        check("B가 소리를 넘겨받음", sb["owner"] == sb["dev"] and sb["audio"] and sb["playing"], sb)
        check("넘겨준 A에도 멈춤 버튼", "ic-pause" in icon(a), icon(a))

        # 이번엔 A(소리 없음)에서 멈춤 → B가 멈추고, A에서 다시 재생 → A에서 소리
        a.click(btn(a)); a.wait_for_timeout(1200)
        sa, sb = st(a), st(b)
        check("A의 멈춤으로 B가 멈춤", not sb["audio"] and not sb["playing"] and not sa["playing"], (sa, sb))
        a.click(btn(a)); a.wait_for_timeout(2000)
        sa, sb = st(a), st(b)
        check("A에서 재생 → A에서 소리", sa["audio"] and not sb["audio"] and sb["playing"], (sa, sb))
        a.click(btn(a)); a.wait_for_timeout(800)
        b.click(btn(b)); b.wait_for_timeout(2000)  # 다시 B로 (아래 시험은 B가 소리를 내는 상태에서)
        sa, sb = st(a), st(b)
        check("A는 소리 없이 비춤", not sa["audio"] and sa["playing"] and sa["remote"] == "PC" and sa["id"] == sb["id"], sa)
        check("이어서 재생 (처음부터가 아님)", sb["pos"] >= pos_before, (pos_before, sb["pos"]))

        # A에서 탐색 → B의 위치가 바뀜
        a.evaluate("P.seek(8000)"); a.wait_for_timeout(1200)
        sb = st(b)
        check("A의 탐색이 B에 반영", 8000 <= sb["pos"] < 11000, sb["pos"])

        # A에서 셔플 → B 대기열이 섞이고 셔플이 켜짐
        a.evaluate("P.toggleShuffle()"); a.wait_for_timeout(1200)
        sa, sb = st(a), st(b)
        check("A의 셔플이 B에 반영", sb["shuffle"] and sa["shuffle"] and sb["id"] == sa["id"], (sa, sb))
        check("대기열이 같음", a.evaluate("P.queue.join()") == b.evaluate("P.queue.join()"))

        # A에서 다른 테이프를 새로 재생 → A가 다시 소리를 맡음
        a.evaluate("P.playList(L.tracks.slice(0, 5).map(t => t.id), 2, { type: 'collection', name: '' })"); a.wait_for_timeout(2000)
        sa, sb = st(a), st(b)
        check("새로 재생한 쪽이 소리를 맡음", sa["audio"] and not sb["audio"] and sb["id"] == sa["id"] and sb["q"] == 5, (sa, sb))

        check("스크립트 오류 없음", not errors, errors[:3])
        browser.close()
    srv.shutdown()
    if fails:
        print("\n동기화 시험 실패")
        sys.exit(1)
    print("\n동기화 시험 통과")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
