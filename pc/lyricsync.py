"""싱크 가사 생성기의 설치와 실행을 맡는다 (PC 프로그램 안에서 돈다).

생성기는 PyTorch·Whisper·보컬 분리 모델이 필요해 수 GB가 되므로 exe에 넣지 않는다.
사용자가 고른 폴더 아래 「TapeBox-LyricSync」에 uv로 Python 환경을 따로 만들고, 모델과 캐시도 모두 그 안에 둔다.
생성기는 그 환경의 python으로 lyricsync_worker.py를 띄우고, 한 줄짜리 JSON 출력을 읽어 진행 상황을 모은다.

만드는 방식은 둘이다.
  folder: PC에 복사해 둔 음원 폴더로 만든다. 폰이 필요 없고, 다 만든 뒤 「폰에 보내기」로 폰 DB에 넣는다.
  phone:  폰에서 곡을 하나씩 받아 만들고 바로 폰에 저장한다.

생성 도구 폴더 안의 파일
  results.jsonl  곡마다 마지막 줄이 그 곡의 결과
  made/          만든 LRC (폰에 보내거나 폰 데이터가 지워졌을 때 되살리는 원본)
  sent.json      PC 폴더 방식으로 만든 곡 중 폰에 보낸 것 {곡 키: {phone: 폰 곡 id, at: 보낸 시각}}
  notfound.json  보낼 때 폰에서 짝을 찾지 못한 곡 키
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
import urllib.error
import urllib.parse
import urllib.request
import zipfile

SUBDIR = "TapeBox-LyricSync"
UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
TORCH = ["torch==2.6.0", "torchaudio==2.6.0"]
PACKAGES = ["stable-ts==2.19.1", "demucs==4.0.1", "imageio-ffmpeg", "packaging", "mutagen"]
TORCH_INDEX = {"cuda": "https://download.pytorch.org/whl/cu124", "cpu": "https://download.pytorch.org/whl/cpu"}
NEED_GB = 12          # 설치하는 동안 필요한 여유 공간 (끝나면 캐시를 지워 7GB 정도로 줄어든다)
LAYOUT = 2            # 설치 형식이 바뀌면 올려서 업데이트하게 한다 (2: 음원 파일 태그를 읽는 mutagen 추가)
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
DUR_TOLERANCE = 2.5   # 폰과 PC가 잰 곡 길이 차이를 이만큼(초)까지 같은 곡으로 본다
MADE = ("done", "check", "kept", "restored")
# 결과 기록의 상태 → 화면 목록 종류
KIND = {"done": "made", "kept": "made", "restored": "made", "check": "check", "fail": "fail",
        "skip": "skip", "rejected": "rejected"}  # retry는 어느 목록에도 넣지 않는다
REFUSED = "폰이 연결을 거부했어요. PC 프로그램에서 PIN으로 다시 연결해 주세요."


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


def _norm(s):
    return (s or "").strip().lower()


class PhoneAPI:
    def __init__(self, server, token):
        self.server, self.token = (server or "").rstrip("/"), token or ""

    def call(self, method, path, body=None, timeout=20):
        data, headers = None, {"Cookie": "mc_token=" + self.token}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.server + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
        return json.loads(raw.decode("utf-8")) if raw else {}


class LyricSync:
    def __init__(self, load_config, save_config):
        self._load, self._save = load_config, save_config
        self.lock = threading.RLock()
        self.phase = "idle"          # idle | installing | running | sending | removing
        self.step = ""
        self.log = []                # 최근 출력 몇 줄
        self.error = ""
        self.notice = ""             # 끝난 작업의 안내 한 줄
        self.proc = None
        self.stopping = False
        self.run = None              # 이번 실행의 진행 상황
        self.send = None             # 이번 「폰에 보내기」의 진행 상황

    # ───── 설정 ─────
    def _cfg(self, k, default=""):
        return self._load().get(k) or default

    def _set_cfg(self, **kv):
        cfg = self._load()
        cfg.update(kv)
        self._save(cfg)

    @property
    def parent(self):
        return self._cfg("lyricsync_dir")

    @property
    def home(self):
        return os.path.join(self.parent, SUBDIR) if self.parent else ""

    @property
    def source(self):
        return self._cfg("lyricsync_source", "folder")

    @property
    def music_dir(self):
        return self._cfg("lyricsync_music")

    def _py(self):
        return os.path.join(self.home, "env", "Scripts", "python.exe")

    def _ready_raw(self):
        try:
            with open(os.path.join(self.home, "ready.json"), encoding="utf-8") as f:
                o = json.load(f)
            return o if os.path.exists(self._py()) else None
        except Exception:
            return None

    def _ready_info(self):
        o = self._ready_raw()
        return o if o and o.get("layout") == LAYOUT else None

    # ───── 결과 기록 ─────
    def _p(self, name):
        return os.path.join(self.home, name)

    def _made(self, key):
        return os.path.join(self.home, "made", hashlib.sha1(key.encode("utf-8")).hexdigest()[:20] + ".lrc")

    def _last(self):
        last = {}
        try:
            with open(self._p("results.jsonl"), encoding="utf-8") as f:
                for line in f:
                    try:
                        o = json.loads(line)
                        last[o["id"]] = o
                    except Exception:
                        pass
        except Exception:
            pass
        return last

    def _json(self, name, default):
        try:
            with open(self._p(name), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default

    def _write_json(self, name, value):
        tmp = self._p(name) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
        os.replace(tmp, self._p(name))

    def _compact(self):
        """같은 곡의 지난 기록을 버리고 마지막 것만 남긴다 (생성기가 돌지 않을 때만)"""
        last = self._last()
        if not last:
            return
        tmp = self._p("results.jsonl") + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for o in last.values():
                f.write(json.dumps(o, ensure_ascii=False) + "\n")
        os.replace(tmp, self._p("results.jsonl"))

    def _phone_id(self, o, sent):
        if o.get("mode") == "phone" or (not o.get("mode") and not o.get("path")):  # 폰 방식(이전 버전 포함)은 id가 곧 폰 곡 id
            return o.get("phoneId") or o["id"]
        return (sent.get(o["id"]) or {}).get("phone")

    def _pending(self, last=None, sent=None):
        """PC 폴더 방식으로 만들었지만 아직 폰에 보내지 않은(또는 보낸 뒤 다시 만든) 곡"""
        last = self._last() if last is None else last
        sent = self._json("sent.json", {}) if sent is None else sent
        out = []
        for o in last.values():
            if o.get("mode") != "folder" or o.get("status") not in MADE:
                continue
            path = self._made(o["id"])
            if not os.path.exists(path):
                continue
            s = sent.get(o["id"])
            # 보낸 뒤 바뀌지 않았고 폰의 확인 필요 표시도 맞으면 건너뛴다 (표시가 없던 때 보낸 확인 필요 곡은 한 번 더 보낸다)
            if s and s.get("at", 0) >= int(os.path.getmtime(path)) and s.get("check", False) == (o.get("status") == "check"):
                continue
            out.append(o)
        return out

    def _counts(self):
        c = {k: 0 for k in ("made", "check", "fail", "skip", "rejected")}
        last = self._last()
        for o in last.values():
            k = KIND.get(o.get("status"))
            if k:
                c[k] += 1
        c["pending"] = len(self._pending(last))
        nf = set(self._json("notfound.json", []))
        c["notfound"] = sum(1 for k in nf if k in last and last[k].get("status") in MADE)
        return c

    def results(self, kind):
        last, sent = self._last(), self._json("sent.json", {})
        if kind == "notfound":
            nf = set(self._json("notfound.json", []))
            items = [o for k, o in last.items() if k in nf and o.get("status") in MADE]
        else:
            items = [o for o in last.values() if KIND.get(o.get("status")) == kind]
        items.sort(key=lambda o: -o.get("at", 0))
        out = []
        for o in items:
            d = {k: o.get(k) for k in ("id", "title", "artist", "status", "reason", "path")}
            d["phoneId"] = self._phone_id(o, sent)
            out.append(d)
        return out

    def _record(self, items, status):
        with self.lock:
            with open(self._p("results.jsonl"), "a", encoding="utf-8") as f:
                for o in items:
                    keep = {k: o.get(k) for k in ("id", "title", "artist", "album", "seconds", "path", "mode", "phoneId") if o.get(k) is not None}
                    f.write(json.dumps(dict(keep, status=status, at=int(time.time())), ensure_ascii=False) + "\n")

    def review(self, server, token, ids, action):
        """결과 목록의 곡을 정리한다.
        keep: 확인 필요였지만 괜찮다고 표시 / revert: 폰의 만든 가사와 PC 사본을 지워 원래 가사로 돌리고 다시 만들지 않게 표시
        retry: 되돌린 곡을 다음 실행 때 다시 만들게 표시"""
        if not self.home:
            return {"ok": False, "error": "생성 도구가 설치돼 있지 않아요"}
        last = self._last()
        items = [last[i] for i in ids if i in last]
        if action == "keep":
            items = [o for o in items if o.get("status") == "check"]
            self._record(items, "kept")
            self._uncheck_on_phone(server, token, items)
            return {"ok": True, "count": len(items)}
        if action == "retry":
            items = [o for o in items if o.get("status") == "rejected"]
            self._record(items, "retry")
            return {"ok": True, "count": len(items)}
        phone, sent = PhoneAPI(server, token), self._json("sent.json", {})
        done, failed = [], 0
        for o in items:
            if o.get("status") not in MADE:
                continue
            pid = self._phone_id(o, sent)
            if pid:  # 폰에 들어가 있는 곡이면 폰에서도 지운다
                try:
                    phone.call("DELETE", "/api/lyrics/" + urllib.parse.quote(pid, safe=""))
                except Exception:
                    failed += 1
                    continue
            try:
                os.remove(self._made(o["id"]))
            except FileNotFoundError:
                pass
            sent.pop(o["id"], None)
            done.append(o)
        self._write_json("sent.json", sent)
        self._record(done, "rejected")
        if failed:
            return {"ok": False, "error": f"{failed}곡은 폰에 연결하지 못해 되돌리지 못했어요"}
        return {"ok": True, "count": len(done)}

    def sync_rejected(self, server, token):
        """폰의 가사 화면에서 되돌린 곡을 받아 와 결과 기록에 반영한다: PC 사본을 지우고 되돌린 곡으로 표시해
        다시 만들거나 되살리거나 보내지 않게. 폰에 닿지 않으면 다음 기회에 한다"""
        if not self.home or not token:
            return {"ok": False}
        try:
            items = PhoneAPI(server, token).call("GET", "/api/lyrics-rejected", timeout=10).get("items") or []
            at = {o["id"]: (o.get("at") or 0) / 1000 for o in items}
        except Exception:
            return {"ok": False}
        if not at:
            return {"ok": True, "count": 0}
        with self.lock:
            last, sent = self._last(), self._json("sent.json", {})
            done = []
            for o in last.values():
                pid = self._phone_id(o, sent)
                # 되돌린 뒤에 다시 만든 곡(「다시 만들기」)은 새 결과가 우선이다
                if o.get("status") in MADE and pid in at and at[pid] >= o.get("at", 0):
                    try:
                        os.remove(self._made(o["id"]))
                    except FileNotFoundError:
                        pass
                    sent.pop(o["id"], None)
                    done.append(o)
            if done:
                self._write_json("sent.json", sent)
                self._record(done, "rejected")
        return {"ok": True, "count": len(done)}

    def _uncheck_on_phone(self, server, token, items):
        """괜찮다고 표시한 곡은 폰 가사 화면에서도 확인 필요 표시(되돌리기 버튼)를 뗀다. 폰에 닿지 않으면 그대로 둔다"""
        if not token:
            return
        phone, sent = PhoneAPI(server, token), self._json("sent.json", {})
        try:
            for o in items:
                pid, path = self._phone_id(o, sent), self._made(o["id"])
                if not pid or not os.path.exists(path):
                    continue
                with open(path, encoding="utf-8") as f:
                    phone.call("PUT", "/api/lyrics/" + urllib.parse.quote(pid, safe=""), {"lrc": f.read(), "source": "aligned", "check": False})
                if o["id"] in sent:
                    sent[o["id"]]["check"] = False
        except Exception:
            pass  # 못 뗀 곡은 다음 「폰에 보내기」 때 고쳐진다
        finally:
            self._write_json("sent.json", sent)

    def reset(self, server, token):
        """결과 기록과 PC 사본을 모두 지우고, 폰에 저장된 만든 싱크 가사도 지운다"""
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 지울 수 없어요"}
            if not self.home:
                return {"ok": False, "error": "생성 도구가 설치돼 있지 않아요"}
        phone_ok = True
        try:
            PhoneAPI(server, token).call("DELETE", "/api/lyrics")
        except Exception:
            phone_ok = False
        for name in ("results.jsonl", "sent.json", "notfound.json"):
            try:
                os.remove(self._p(name))
            except FileNotFoundError:
                pass
        shutil.rmtree(self._p("made"), ignore_errors=True)
        with self.lock:
            self.run = self.send = None
            self.error, self.notice = "", ""
        return {"ok": True, "phone": phone_ok}

    # ───── 상태 ─────
    def state(self):
        with self.lock:
            raw = self._ready_raw() if self.home else None
            ready = raw if raw and raw.get("layout") == LAYOUT else None
            music = self.music_dir
            return {
                "parent": self.parent, "home": self.home,
                "freeGb": free_gb(self.parent) if self.parent else None, "needGb": NEED_GB,
                "installed": bool(ready), "outdated": bool(raw) and not ready,
                "device": (raw or {}).get("device"), "gpu": (raw or {}).get("gpu"),
                "source": self.source, "musicDir": music, "musicOk": bool(music) and os.path.isdir(music),
                "phase": self.phase, "step": self.step, "log": self.log[-6:], "error": self.error, "notice": self.notice,
                "run": self.run, "send": self.send, "counts": self._counts() if self.home else {},
            }

    def set_parent(self, path):
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 바꿀 수 없어요"}
            if self._ready_raw():
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
            self._set_cfg(lyricsync_dir=path)
            self.error = ""
            return {"ok": True}

    def set_source(self, source):
        if source not in ("folder", "phone"):
            return {"ok": False, "error": "알 수 없는 방식"}
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 바꿀 수 없어요"}
            self._set_cfg(lyricsync_source=source)
        return {"ok": True}

    def set_music_dir(self, path):
        path = os.path.abspath(path)
        if not os.path.isdir(path):
            return {"ok": False, "error": "폴더를 찾을 수 없어요"}
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "작업 중에는 바꿀 수 없어요"}
            self._set_cfg(lyricsync_music=path)
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
        """처음 설치와 업데이트를 겸한다. 이미 받은 것은 건너뛰므로 업데이트는 금방 끝난다"""
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "이미 작업 중이에요"}
            if not self.parent:
                return {"ok": False, "error": "생성 도구를 설치할 위치를 먼저 골라 주세요"}
            free = free_gb(self.parent)
            if not self._ready_raw() and free is not None and free < NEED_GB:
                return {"ok": False, "error": f"여유 공간이 부족해요 ({free}GB 남음, {NEED_GB}GB 필요)"}
            self.phase, self.step, self.log, self.error, self.notice, self.stopping = "installing", "준비하는 중…", [], "", "", False
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
            self._set_step("")
            with self.lock:
                self.notice = "생성 도구를 준비했어요"
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
            try:
                os.remove(os.path.join(self.home, "worker.py"))
            except FileNotFoundError:
                pass
            return {"ok": True}
        finally:
            with self.lock:
                self.phase, self.step = "idle", ""

    # ───── 생성 ─────
    def start(self, server, token):
        if self.phase == "idle":
            self.sync_rejected(server, token)  # 폰에서 되돌린 곡은 다시 만들거나 되살리지 않게 먼저 반영
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "이미 작업 중이에요"}
            if not self._ready_info():
                return {"ok": False, "error": "먼저 생성 도구를 설치(업데이트)해 주세요"}
            mode = self.source
            if mode == "folder":
                if not self.music_dir or not os.path.isdir(self.music_dir):
                    return {"ok": False, "error": "음원 폴더를 먼저 골라 주세요"}
                args = ["--folder", self.music_dir]
            else:
                if not token:
                    return {"ok": False, "error": "폰에 연결돼 있지 않아요"}
                args = ["--server", server, "--token", token]
            try:
                self._compact()
            except Exception:
                pass
            self.phase, self.log, self.error, self.notice, self.stopping = "running", [], "", "", False
            self.step = "음원 파일을 찾는 중…" if mode == "folder" else "폰에서 곡 목록을 받는 중…"
            self.run = {"mode": mode, "total": 0, "i": 0, "done": 0, "check": 0, "fail": 0, "skip": 0, "restored": 0,
                        "current": None, "device": None, "startedAt": int(time.time()), "secs": [], "finished": False}
        threading.Thread(target=self._run, args=(args,), daemon=True).start()
        return {"ok": True}

    def _run(self, args):
        h = self.home
        try:
            # 프로그램이 업데이트되면 생성기도 새 것으로
            shutil.copy2(_here("lyricsync_worker.py"), os.path.join(h, "worker.py"))
            env = dict(self._uv_env(), PYTHONUTF8="1")
            p = subprocess.Popen([self._py(), "-u", os.path.join(h, "worker.py"), "--home", h, *args],
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

    # ───── 폰에 보내기 (PC 폴더 방식으로 만든 가사) ─────
    def start_send(self, server, token):
        if self.phase == "idle":
            self.sync_rejected(server, token)  # 폰에서 되돌린 곡은 다시 보내지 않게 먼저 반영
        with self.lock:
            if self.phase != "idle":
                return {"ok": False, "error": "이미 작업 중이에요"}
            if not self.home:
                return {"ok": False, "error": "생성 도구가 설치돼 있지 않아요"}
            if not token:
                return {"ok": False, "error": "폰에 연결돼 있지 않아요"}
            self.phase, self.error, self.notice, self.stopping = "sending", "", "", False
            self.step = "폰에서 곡 목록을 받는 중…"
            self.send = {"total": 0, "i": 0, "sent": 0, "notfound": 0, "finished": False}
        threading.Thread(target=self._send, args=(server, token), daemon=True).start()
        return {"ok": True}

    def _send(self, server, token):
        phone = PhoneAPI(server, token)
        sent = self._json("sent.json", {})
        notfound = set(self._json("notfound.json", []))
        try:
            try:
                lib = phone.call("GET", "/api/library", timeout=60)
            except urllib.error.HTTPError as e:
                raise RuntimeError(REFUSED if e.code == 401 else f"폰에서 곡 목록을 받지 못했어요 (응답 {e.code})")
            except Exception:
                raise RuntimeError("폰에 연결할 수 없어요. 폰 앱을 켜고 다시 눌러 주세요.")
            # 확인 필요 표시를 모르는 예전 폰 앱이면 표시를 보냈다고 적지 않는다 (앱을 업데이트한 뒤 다시 보내면 채워진다)
            try:
                phone.call("GET", "/api/lyrics-rejected", timeout=10)
                flags = True
            except Exception:
                flags = False
            ids, by_meta, by_title = set(), {}, {}
            for t in lib.get("tracks", []):
                ids.add(t["id"])
                sec = (t.get("duration") or 0) / 1000.0
                by_meta.setdefault((_norm(t.get("title")), _norm(t.get("artist")), _norm(t.get("album"))), []).append((sec, t["id"]))
                by_title.setdefault(_norm(t.get("title")), []).append((sec, t["id"]))

            def match(o):
                if o["id"] in ids:  # 곡 정보와 길이가 폰과 똑같으면 키도 같다
                    return o["id"]
                sec = o.get("seconds") or 0

                def near(pool):
                    return sorted((abs(s - sec), pid) for s, pid in pool if abs(s - sec) <= DUR_TOLERANCE)
                # 제목·아티스트·앨범이 같고 길이가 비슷한 곡
                same = near(by_meta.get((_norm(o.get("title")), _norm(o.get("artist")), _norm(o.get("album"))), []))
                if same:
                    return same[0][1]
                # 아티스트·앨범 표기가 다르게 읽혔을 때: 제목과 길이로 하나만 맞으면 그 곡
                by_t = near(by_title.get(_norm(o.get("title")), []))
                return by_t[0][1] if len(by_t) == 1 else None

            todo = self._pending(sent=sent)
            with self.lock:
                self.send["total"] = len(todo)
                self.step = ""
            for i, o in enumerate(todo, 1):
                if self.stopping:
                    break
                pid = match(o)
                if not pid:
                    notfound.add(o["id"])
                    with self.lock:
                        self.send["i"], self.send["notfound"] = i, self.send["notfound"] + 1
                    continue
                with open(self._made(o["id"]), encoding="utf-8") as f:
                    lrc = f.read()
                try:
                    phone.call("PUT", "/api/lyrics/" + urllib.parse.quote(pid, safe=""),
                               {"lrc": lrc, "source": "aligned", "check": o.get("status") == "check"})
                except urllib.error.HTTPError as e:
                    if e.code == 401:
                        raise RuntimeError(REFUSED)
                    notfound.add(o["id"])
                    with self.lock:
                        self.send["i"], self.send["notfound"] = i, self.send["notfound"] + 1
                    continue
                except Exception:
                    raise RuntimeError("보내는 중에 폰 연결이 끊겼어요. 다시 누르면 남은 곡만 보내요.")
                sent[o["id"]] = {"phone": pid, "at": int(time.time())}
                if flags:
                    sent[o["id"]]["check"] = o.get("status") == "check"
                notfound.discard(o["id"])
                with self.lock:
                    self.send["i"], self.send["sent"] = i, self.send["sent"] + 1
                if i % 50 == 0:
                    self._write_json("sent.json", sent)
            with self.lock:
                s = self.send
                if not self.stopping:
                    self.notice = ((f"{s['sent']}곡을 폰에 보냈어요" if s["sent"] else "새로 보낼 곡이 없어요")
                                   + (f" · 폰에서 짝을 찾지 못한 곡 {s['notfound']}곡" if s["notfound"] else ""))
        except Exception as e:
            with self.lock:
                self.error = str(e)
        finally:
            try:
                self._write_json("sent.json", sent)
                self._write_json("notfound.json", sorted(notfound))
            except Exception:
                pass
            with self.lock:
                if self.send:
                    self.send["finished"] = True
                self.phase, self.step = "idle", ""
