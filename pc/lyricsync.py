"""싱크 가사 생성기의 설치와 실행을 맡는다 (PC 프로그램 안에서 돈다).

생성기는 PyTorch·Whisper·보컬 분리 모델이 필요해 수 GB가 되므로 exe에 넣지 않는다.
사용자가 고른 폴더 아래 「TapeBox-LyricSync」에 uv로 Python 환경을 따로 만들고, 모델과 캐시도 모두 그 안에 둔다.
생성기는 그 환경의 python으로 lyricsync_worker.py를 띄우고, 한 줄짜리 JSON 출력을 읽어 진행 상황을 모은다.
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile

SUBDIR = "TapeBox-LyricSync"
UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
TORCH = ["torch==2.6.0", "torchaudio==2.6.0"]
PACKAGES = ["stable-ts==2.19.1", "demucs==4.0.1", "imageio-ffmpeg", "packaging"]
TORCH_INDEX = {"cuda": "https://download.pytorch.org/whl/cu124", "cpu": "https://download.pytorch.org/whl/cpu"}
NEED_GB = 12          # 설치하는 동안 필요한 여유 공간 (끝나면 캐시를 지워 7GB 정도로 줄어든다)
LAYOUT = 1            # 설치 형식이 바뀌면 올려서 다시 설치하게 한다
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
# 결과 기록의 상태 → 화면 목록 종류
KIND = {"done": "made", "kept": "made", "restored": "made", "check": "check", "fail": "fail",
        "skip": "skip", "rejected": "rejected"}  # retry는 어느 목록에도 넣지 않는다


def _here(name):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def free_gb(path):
    p = path
    while p and not os.path.exists(p):
        np_ = os.path.dirname(p)
        if np_ == p:
            break
        p = np_
    try:
        return round(shutil.disk_usage(p).free / 1024 ** 3, 1)
    except Exception:
        return None


def detect_gpu():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True,
                             text=True, timeout=10, creationflags=NO_WINDOW)
        name = out.stdout.strip().splitlines()[0].strip() if out.returncode == 0 and out.stdout.strip() else ""
        return name or None
    except Exception:
        return None


class LyricSync:
    def __init__(self, load_config, save_config):
        self._load, self._save = load_config, save_config
        self.lock = threading.Lock()
        self.phase = "idle"          # idle | installing | running | removing
        self.step = ""
        self.log = []                # 최근 출력 몇 줄
        self.error = ""
        self.proc = None
        self.stopping = False
        self.run = None              # 이번 실행의 진행 상황

    # ───── 위치·상태 ─────
    @property
    def parent(self):
        return self._load().get("lyricsync_dir") or ""

    @property
    def home(self):
        return os.path.join(self.parent, SUBDIR) if self.parent else ""

    def _py(self):
        return os.path.join(self.home, "env", "Scripts", "python.exe")

    def _ready_info(self):
        try:
            with open(os.path.join(self.home, "ready.json"), encoding="utf-8") as f:
                o = json.load(f)
            return o if o.get("layout") == LAYOUT and os.path.exists(self._py()) else None
        except Exception:
            return None

    # ───── 결과 기록 (results.jsonl: 곡마다 마지막 줄이 그 곡의 상태) ─────
    def _results_path(self):
        return os.path.join(self.home, "results.jsonl")

    def _last(self):
        last = {}
        try:
            with open(self._results_path(), encoding="utf-8") as f:
                for line in f:
                    try:
                        o = json.loads(line)
                        last[o["id"]] = o
                    except Exception:
                        pass
        except Exception:
            pass
        return last

    def _compact(self):
        """같은 곡의 지난 기록을 버리고 마지막 것만 남긴다 (생성기가 돌지 않을 때만)"""
        last = self._last()
        if not last:
            return
        tmp = self._results_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for o in last.values():
                f.write(json.dumps(o, ensure_ascii=False) + "\n")
        os.replace(tmp, self._results_path())

    def _counts(self):
        c = {k: 0 for k in ("made", "check", "fail", "skip", "rejected")}
        for o in self._last().values():
            k = KIND.get(o.get("status"))
            if k:
                c[k] += 1
        return c

    def results(self, kind):
        items = [o for o in self._last().values() if KIND.get(o.get("status")) == kind]
        items.sort(key=lambda o: -o.get("at", 0))
        return [{k: o.get(k) for k in ("id", "title", "artist", "status", "reason")} for o in items]

    def _record(self, items, status):
        with self.lock:
            with open(self._results_path(), "a", encoding="utf-8") as f:
                for o in items:
                    f.write(json.dumps({"status": status, "id": o["id"], "title": o.get("title"), "artist": o.get("artist"),
                                        "at": int(time.time())}, ensure_ascii=False) + "\n")

    def review(self, server, token, ids, action):
        """결과 목록의 곡을 정리한다.
        keep: 확인 필요였지만 괜찮다고 표시 / revert: 폰의 만든 가사와 PC 사본을 지워 원래 가사로 돌리고 다시 만들지 않게 표시
        retry: 되돌린 곡을 다음 실행 때 다시 만들게 표시"""
        if not self.home:
            return {"ok": False, "error": "생성 도구가 설치돼 있지 않아요"}
        last = self._last()
        items = [last[i] for i in ids if i in last]
        if action == "keep":
            self._record([o for o in items if o.get("status") == "check"], "kept")
            return {"ok": True, "count": len(items)}
        if action == "retry":
            items = [o for o in items if o.get("status") == "rejected"]
            self._record(items, "retry")
            return {"ok": True, "count": len(items)}
        done, failed = [], 0
        for o in items:
            if KIND.get(o.get("status")) not in ("made", "check"):
                continue
            req = urllib.request.Request(server.rstrip("/") + "/api/lyrics/" + urllib.parse.quote(o["id"], safe=""),
                                         method="DELETE", headers={"Cookie": "mc_token=" + token})
            try:
                urllib.request.urlopen(req, timeout=15).close()
            except Exception:
                failed += 1
                continue
            try:
                os.remove(os.path.join(self.home, "made", hashlib.sha1(o["id"].encode("utf-8")).hexdigest()[:20] + ".lrc"))
            except FileNotFoundError:
                pass
            done.append(o)
        self._record(done, "rejected")
        if failed:
            return {"ok": False, "error": f"{failed}곡은 폰에 연결하지 못해 되돌리지 못했어요"}
        return {"ok": True, "count": len(done)}

    def state(self):
        with self.lock:
            ready = self._ready_info() if self.home else None
            return {
                "parent": self.parent, "home": self.home,
                "freeGb": free_gb(self.parent) if self.parent else None, "needGb": NEED_GB,
                "installed": bool(ready), "device": (ready or {}).get("device"), "gpu": (ready or {}).get("gpu"),
                "phase": self.phase, "step": self.step, "log": self.log[-6:], "error": self.error,
                "run": self.run, "counts": self._counts() if self.home else {},
            }

    def set_parent(self, path):
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 바꿀 수 없어요"}
            if self._ready_info():
                return {"ok": False, "error": "생성 도구가 이미 설치돼 있어요. 위치를 바꾸려면 먼저 생성 도구를 지워 주세요"}
            path = os.path.abspath(path)
            try:
                os.makedirs(os.path.join(path, SUBDIR), exist_ok=True)
                probe = os.path.join(path, SUBDIR, ".write-test")
                with open(probe, "w") as f:
                    f.write("ok")
                os.remove(probe)
            except Exception as e:
                return {"ok": False, "error": f"이 폴더에는 쓸 수 없어요 ({e})"}
            cfg = self._load()
            cfg["lyricsync_dir"] = path
            self._save(cfg)
            self.error = ""
            return {"ok": True}

    # ───── 설치 ─────
    def _sub(self, args, env=None):
        """하위 프로세스를 돌리며 출력을 log에 쌓는다. 실패하면 예외"""
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                             creationflags=NO_WINDOW, text=True, encoding="utf-8", errors="replace")
        with self.lock:
            self.proc = p
        for line in p.stdout:
            line = line.rstrip()
            if line:
                with self.lock:
                    self.log = (self.log + [line[-300:]])[-40:]
        p.wait()
        with self.lock:
            self.proc = None
        if self.stopping:
            raise InterruptedError("멈춤")
        if p.returncode != 0:
            raise RuntimeError("\n".join(self.log[-3:]) or f"exit {p.returncode}")
        return p

    def _uv_env(self):
        env = dict(os.environ)
        h = self.home
        env.update({
            "UV_CACHE_DIR": os.path.join(h, "cache"), "UV_PYTHON_INSTALL_DIR": os.path.join(h, "python"),
            "UV_PYTHON_PREFERENCE": "only-managed", "UV_LINK_MODE": "copy", "UV_NO_CONFIG": "1",
            "PYTHONIOENCODING": "utf-8", "TEMP": os.path.join(h, "tmp"), "TMP": os.path.join(h, "tmp"),
        })
        return env

    def install(self):
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "이미 작업 중이에요"}
            if not self.parent:
                return {"ok": False, "error": "생성 도구를 설치할 위치를 먼저 골라 주세요"}
            free = free_gb(self.parent)
            if free is not None and free < NEED_GB:
                return {"ok": False, "error": f"여유 공간이 부족해요 ({free}GB 남음, {NEED_GB}GB 필요)"}
            self.phase, self.step, self.log, self.error, self.stopping = "installing", "준비하는 중…", [], "", False
        threading.Thread(target=self._install, daemon=True).start()
        return {"ok": True}

    def _set_step(self, text):
        with self.lock:
            self.step = text

    def _install(self):
        h = self.home
        try:
            for d in ("tmp", "bin"):
                os.makedirs(os.path.join(h, d), exist_ok=True)
            uv = os.path.join(h, "uv", "uv.exe")
            if not os.path.exists(uv):
                self._set_step("설치 도구(uv)를 받는 중…")
                with urllib.request.urlopen(UV_URL, timeout=120) as r:
                    data = r.read()
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for n in z.namelist():
                        if n.lower().endswith("uv.exe"):
                            os.makedirs(os.path.dirname(uv), exist_ok=True)
                            with z.open(n) as src, open(uv, "wb") as dst:
                                shutil.copyfileobj(src, dst)
                if not os.path.exists(uv):
                    raise RuntimeError("uv를 받지 못했어요")
            env = self._uv_env()
            gpu = detect_gpu()
            device = "cuda" if gpu else "cpu"

            self._set_step("Python을 준비하는 중…")
            self._sub([uv, "venv", os.path.join(h, "env"), "--python", "3.12", "--allow-existing"], env)
            py = self._py()
            self._set_step("PyTorch를 받는 중… " + ("(GPU용, 2.5GB 정도라 오래 걸려요)" if gpu else "(CPU용)"))
            self._sub([uv, "pip", "install", "--python", py, *TORCH, "--index-url", TORCH_INDEX[device]], env)
            self._set_step("정렬 도구를 받는 중…")
            self._sub([uv, "pip", "install", "--python", py, *TORCH, *PACKAGES], env)

            shutil.copy2(_here("lyricsync_worker.py"), os.path.join(h, "worker.py"))
            self._set_step("모델을 받는 중…")
            self._sub([py, "-u", os.path.join(h, "worker.py"), "--home", h, "--prepare"], dict(env, PYTHONUTF8="1"))

            self._set_step("임시 파일을 정리하는 중…")
            try:
                self._sub([uv, "cache", "clean"], env)
            except Exception:
                pass
            with open(os.path.join(h, "ready.json"), "w", encoding="utf-8") as f:
                json.dump({"layout": LAYOUT, "device": device, "gpu": gpu, "at": int(time.time())}, f)
            self._set_step("생성 도구 설치를 마쳤어요")
        except InterruptedError:
            with self.lock:
                self.error = "생성 도구 설치를 멈췄어요. 다시 누르면 받은 데부터 이어서 해요."
        except Exception as e:
            with self.lock:
                self.error = f"생성 도구를 설치하지 못했어요: {e}"
        finally:
            with self.lock:
                self.phase, self.proc = "idle", None

    def remove(self):
        """설치한 환경과 모델을 지운다. 만든 가사 사본(made)과 기록은 남긴다"""
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 지울 수 없어요"}
            if not self.home or not os.path.isdir(self.home):
                return {"ok": False, "error": "설치돼 있지 않아요"}
            self.phase, self.step, self.error = "removing", "지우는 중…", ""
        try:
            try:
                os.remove(os.path.join(self.home, "ready.json"))
            except FileNotFoundError:
                pass
            for d in ("env", "python", "cache", "models", "uv", "bin", "tmp"):
                shutil.rmtree(os.path.join(self.home, d), ignore_errors=True)
            for f in ("worker.py",):
                try:
                    os.remove(os.path.join(self.home, f))
                except FileNotFoundError:
                    pass
            return {"ok": True}
        finally:
            with self.lock:
                self.phase, self.step = "idle", ""

    # ───── 생성 ─────
    def start(self, server, token):
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "이미 작업 중이에요"}
            if not self._ready_info():
                return {"ok": False, "error": "먼저 생성 도구를 설치해 주세요"}
            try:
                self._compact()
            except Exception:
                pass
            self.phase, self.step, self.log, self.error, self.stopping = "running", "폰에서 곡 목록을 받는 중…", [], "", False
            self.run = {"total": 0, "i": 0, "done": 0, "check": 0, "fail": 0, "skip": 0, "restored": 0,
                        "current": None, "device": None, "startedAt": int(time.time()), "secs": [], "finished": False}
        threading.Thread(target=self._run, args=(server, token), daemon=True).start()
        return {"ok": True}

    def _run(self, server, token):
        h = self.home
        try:
            # 프로그램이 업데이트되면 생성기도 새 것으로
            shutil.copy2(_here("lyricsync_worker.py"), os.path.join(h, "worker.py"))
            env = dict(self._uv_env(), PYTHONUTF8="1")
            p = subprocess.Popen([self._py(), "-u", os.path.join(h, "worker.py"), "--home", h,
                                  "--server", server, "--token", token],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, creationflags=NO_WINDOW,
                                 text=True, encoding="utf-8", errors="replace")
            with self.lock:
                self.proc = p
            errs = []
            threading.Thread(target=lambda: [errs.append(l.rstrip()) for l in p.stderr], daemon=True).start()
            for line in p.stdout:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                self._on_event(o)
            p.wait()
            with self.lock:
                if not self.stopping and p.returncode not in (0, 2) and not self.error:
                    tail = [e for e in errs if e.strip()][-3:]
                    self.error = "생성기가 멈췄어요: " + (" / ".join(tail) or f"exit {p.returncode}")
        except Exception as e:
            with self.lock:
                self.error = f"생성기를 실행하지 못했어요: {e}"
        finally:
            with self.lock:
                if self.run:
                    self.run["current"] = None
                    self.run["finished"] = True
                    self.run["stopped"] = self.stopping
                self.phase, self.proc, self.step = "idle", None, ""

    def _on_event(self, o):
        t = o.get("type")
        with self.lock:
            r = self.run
            if t == "step":
                self.step = o.get("text", "")
            elif t == "start":
                r["total"] = o.get("total", 0)
                self.step = ""
            elif t == "ready":
                r["device"] = o.get("device")
                self.step = ""
            elif t == "working":
                r["i"] = o.get("i", r["i"])
                r["current"] = {"title": o.get("title"), "artist": o.get("artist")}
            elif t == "track":
                r["i"] = o.get("i", r["i"])
                st = o.get("status")
                if st in r:
                    r[st] += 1
                if o.get("secs"):
                    r["secs"] = (r["secs"] + [o["secs"]])[-20:]
                if st in ("done", "check", "fail"):
                    r["current"] = None
            elif t == "fatal":
                self.error = o.get("text", "")
            elif t == "end":
                self.step = ""

    def stop(self):
        with self.lock:
            self.stopping = True
            p = self.proc
        if p and p.poll() is None:
            try:
                p.terminate()
            except Exception:
                pass
        return {"ok": True}
