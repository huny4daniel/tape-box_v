// 재생기. 대기열·셔플은 여기서 관리하고, 실제 소리는 엔진이 낸다.
//  - WebEngine: PC 브라우저 (폰에서 파일을 실시간으로 받아 <audio>로 재생)
//  - NativeEngine: 폰 앱 안 (Media3 재생 서비스, 화면이 꺼져도 다음 곡으로 넘어감)
//  - RemoteEngine: 다른 기기에서 소리가 날 때 그 상태를 비춰 보고, 조작을 그쪽으로 보낸다 (PC·폰 재생 동기화)
(function () {
  "use strict";

  // 한 번 들은 것으로 치는 기준: 30초 또는 곡 길이의 절반 중 짧은 쪽
  const countThreshold = (dur) => Math.min(30000, Math.max(5000, (dur || 0) * 0.5));

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); }
    off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); }
    emit(ev, a) { (this._h[ev] || []).forEach((f) => { try { f(a); } catch (e) { console.error(e); } }); }
  }

  // ───── 브라우저 쪽 엔진의 공통 부분 (대기열 진행, 들은 시간 기록) ─────
  class QueueEngine extends Emitter {
    constructor(getTrack) {
      super();
      this.getTrack = getTrack;
      this.queue = []; this.index = -1; this.repeat = "off";
      this.playing = false; this.pos = 0; this.dur = 0;
      this._lis = null;
    }
    get currentId() { return this.queue[this.index]; }
    load(queue, index, pos, autoplay) {
      this._finishListen();
      this.queue = queue.slice(); this.index = index;
      this._open(pos || 0, autoplay !== false);
    }
    sync(queue, index) { this.queue = queue.slice(); this.index = index; }
    jump(i) { if (i < 0 || i >= this.queue.length) return; this._finishListen(); this.index = i; this._open(0, true); }
    next(auto) {
      if (!this.queue.length) return;
      if (auto && this.repeat === "one") { this._finishListen(); this._open(0, true); return; }
      let i = this.index + 1;
      if (i >= this.queue.length) {
        if (this.repeat === "all") i = 0;
        else { this._finishListen(); this.pause(); this.seek(0); this._state(); return; }
      }
      this.jump(i);
    }
    prev() {
      if (this.pos > 3000 || this.index <= 0) { this.seek(0); return; }
      this.jump(this.index - 1);
    }
    setRepeat(m) { this.repeat = m; }
    _state() { this.emit("state", { index: this.index, playing: this.playing, pos: this.pos, dur: this.dur }); }
    // 재생 중에 흐른 실제 시간만 센다 (탐색은 들은 시간에 넣지 않음)
    _tickListen() {
      const id = this.currentId; if (!id) return;
      const now = performance.now();
      if (!this._lis || this._lis.id !== id) this._lis = { id, ms: 0, counted: false, last: now };
      const L = this._lis;
      if (this.playing) L.ms += Math.min(1500, Math.max(0, now - L.last));
      L.last = now;
      if (!L.counted && L.ms >= countThreshold(this.dur)) {
        L.counted = true;
        API.reportPlay(id, L.ms, true).catch(() => {});
        L.ms = 0;
        this.emit("played", { id });
      }
    }
    _finishListen() {
      const L = this._lis; this._lis = null;
      if (L && L.ms > 1500) API.reportPlay(L.id, L.ms, false).catch(() => {});
      if (L) this.emit("listened", { id: L.id, ms: L.ms });
    }
  }

  class WebEngine extends QueueEngine {
    constructor(getTrack) {
      super(getTrack);
      const a = this.audio = new Audio();
      a.preload = "auto";
      try { a.volume = parseFloat(localStorage.getItem("mc.vol") || "1"); } catch (e) {}
      a.addEventListener("play", () => { this.playing = true; this._lisReset(); this._state(); });
      a.addEventListener("pause", () => { this._tickListen(); this.playing = false; this._state(); });
      a.addEventListener("timeupdate", () => { this.pos = a.currentTime * 1000; this._tickListen(); this.emit("time", { pos: this.pos, dur: this.dur }); });
      a.addEventListener("durationchange", () => { if (isFinite(a.duration)) this.dur = a.duration * 1000; this._state(); });
      a.addEventListener("ended", () => { this._tickListen(); this.next(true); });
      a.addEventListener("error", () => this._recover());
      a.addEventListener("playing", () => { this._fails = 0; this.emit("link", { ok: true }); });
      // 폰 화면이 꺼져 와이파이가 잠들면 오류 없이 멈춰 버릴 때가 있다. 재생 중인데 시간이 안 흐르면 다시 잇는다
      this._want = false; this._fails = 0; this._lastT = -1; this._still = 0;
      setInterval(() => {
        if (!this._want || a.paused || a.ended || !a.src) { this._still = 0; return; }
        if (a.currentTime !== this._lastT) { this._lastT = a.currentTime; this._still = 0; return; }
        if (++this._still >= 8) { this._still = 0; this._recover(); }
      }, 1000);
      this._mediaSession();
    }
    // 끊긴 곡은 건너뛰지 않고 폰이 다시 응답할 때까지 기다렸다가 끊긴 자리부터 잇는다.
    // 폰은 응답하는데 이 곡만 계속 실패하면 그때 다음 곡으로 넘어간다
    async _recover() {
      const id = this.currentId; if (!id || this._recovering) return;
      this._recovering = true;
      const pos = this.pos, want = this._want;
      try {
        for (let tries = 0; this.currentId === id; tries++) {
          let up = false;
          try { await Promise.race([API.status(), new Promise((_, no) => setTimeout(no, 5000))]); up = true; } catch (e) {}
          if (this.currentId !== id) return;
          if (up) {
            if (++this._fails > 3) { this._fails = 0; this.emit("error", { id }); this.next(true); return; }
            this.emit("link", { ok: true });
            this._reopen(pos, want);
            return;
          }
          if (tries === 0) this.emit("link", { ok: false });
          await new Promise((r) => setTimeout(r, Math.min(10000, 2000 + tries * 1000)));
        }
      } finally { this._recovering = false; }
    }
    _reopen(pos, autoplay) {
      const a = this.audio;
      a.src = API.streamUrl(this.currentId) + "?r=" + Date.now();
      if (pos) a.addEventListener("loadedmetadata", () => { a.currentTime = pos / 1000; }, { once: true });
      if (autoplay) a.play().catch(() => {});
    }
    _lisReset() { if (this._lis) this._lis.last = performance.now(); }
    _open(pos, autoplay) {
      const id = this.currentId; const t = id && this.getTrack(id);
      if (!t) return;
      this.dur = t.duration || 0; this.pos = pos; this._want = !!autoplay; this._fails = 0;
      this.audio.src = API.streamUrl(id);
      if (pos) this.audio.addEventListener("loadedmetadata", () => { this.audio.currentTime = pos / 1000; }, { once: true });
      if (autoplay) this.audio.play().catch(() => { this.playing = false; this._state(); });
      this._meta(t);
      this._state();
    }
    play() {
      if (!this.audio.src && this.currentId) return this._open(this.pos, true);
      this._want = true;
      if (this.audio.error) return this._recover();
      this.audio.play().catch(() => {});
    }
    pause() { this._want = false; this.audio.pause(); }
    toggle() { this.audio.paused ? this.play() : this.pause(); }
    seek(ms) { this.pos = ms; if (this.audio.src) this.audio.currentTime = ms / 1000; this.emit("time", { pos: ms, dur: this.dur }); }
    get volume() { return this.audio.volume; }
    set volume(v) { this.audio.volume = v; try { localStorage.setItem("mc.vol", String(v)); } catch (e) {} }
    _meta(t) {
      if (!("mediaSession" in navigator)) return;
      const art = API.artUrl(t.albumKey, 512);
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [] });
    }
    _mediaSession() {
      if (!("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => this.play());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("nexttrack", () => this.next());
      ms.setActionHandler("previoustrack", () => this.prev());
      try { ms.setActionHandler("seekto", (e) => this.seek(e.seekTime * 1000)); } catch (e) {}
    }
  }

  // ───── 폰 앱 엔진: 실제 재생은 안드로이드 쪽 Media3가 한다 ─────
  class NativeEngine extends Emitter {
    constructor() {
      super();
      this.N = window.NativeBridge;
      this.queue = []; this.index = -1; this.playing = false; this.pos = 0; this.dur = 0; this.repeat = "off";
      this._at = performance.now();
      window.__native = (msg) => this._onNative(typeof msg === "string" ? JSON.parse(msg) : msg);
      // 앱 안에서는 브라우저처럼 시간을 보간해 진행 막대를 부드럽게
      setInterval(() => { if (this.playing) this.emit("time", { pos: this.posNow, dur: this.dur }); }, 250);
    }
    get currentId() { return this.queue[this.index]; }
    get posNow() { return this.playing ? Math.min(this.dur || Infinity, this.pos + (performance.now() - this._at)) : this.pos; }
    restore() {
      try {
        const s = JSON.parse(this.N.getState());
        if (s && s.ids && s.ids.length) { this.queue = s.ids; this._apply(s); return s; }
      } catch (e) { console.warn(e); }
      return null;
    }
    _apply(s) {
      if (s.index != null) this.index = s.index;
      if (s.playing != null) this.playing = s.playing;
      if (s.pos != null) { this.pos = s.pos; this._at = performance.now(); }
      if (s.dur != null && s.dur > 0) this.dur = s.dur;
      if (s.repeat) this.repeat = s.repeat;
      if (s.shuffle != null) this.nShuffle = s.shuffle; // 위젯에서 바꾼 셔플도 따라간다
      if (s.orig) this.nOrig = s.orig;
    }
    _onNative(m) {
      if (m.type === "state") { if (m.ids) this.queue = m.ids; this._apply(m); this.emit("state", { index: this.index, playing: this.playing, pos: this.pos, dur: this.dur }); this.emit("time", { pos: this.pos, dur: this.dur }); }
      else if (m.type === "played") this.emit("played", { id: m.id });
      else if (m.type === "listened") this.emit("listened", { id: m.id, ms: m.ms });
      else if (m.type === "error") this.emit("error", m);
      else this.emit("native", m);
    }
    load(queue, index, pos, autoplay) { this.queue = queue.slice(); this.index = index; this.pos = pos || 0; this._at = performance.now(); this.N.setQueue(JSON.stringify(queue), index, Math.round(pos || 0), autoplay !== false); }
    sync(queue, index) { this.queue = queue.slice(); this.index = index; this.N.syncQueue(JSON.stringify(queue), index); }
    jump(i) { this.index = i; this.N.jump(i); }
    play() { this.N.play(); }
    pause() { this.N.pause(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    next() { this.N.next(); }
    prev() { this.N.prev(); }
    seek(ms) { this.pos = ms; this._at = performance.now(); this.N.seek(Math.round(ms)); this.emit("time", { pos: ms, dur: this.dur }); }
    setRepeat(m) { this.repeat = m; this.N.setRepeat(m); }
    get volume() { return 1; }
    set volume(v) {}
  }

  // ───── 다른 기기가 소리를 낼 때: 그 기기의 상태를 비추고 조작은 그쪽으로 보낸다 ─────
  // 재생(▶)을 누르면 이 기기가 소리를 넘겨받는다. 멈춤·탐색·이전·다음은 소리 내는 기기를 조종한다
  class RemoteEngine extends Emitter {
    constructor(owner) {
      super();
      this.P = owner;
      this.queue = []; this.index = -1; this.playing = false; this.pos = 0; this.dur = 0; this.repeat = "off";
      this._at = performance.now();
      setInterval(() => { if (this.playing && this.P.eng === this) this.emit("time", { pos: this.posNow, dur: this.dur }); }, 250);
    }
    get currentId() { return this.queue[this.index]; }
    get posNow() { return this.playing ? Math.min(this.dur || Infinity, this.pos + (performance.now() - this._at)) : this.pos; }
    // 서버 상태 반영. 대기열이 바뀌었으면 true
    apply(s) {
      const ids = s.ids || [], changed = ids.length !== this.queue.length || ids.some((id, k) => id !== this.queue[k]) || s.index !== this.index;
      this.queue = ids.slice(); this.index = s.index != null ? s.index : -1;
      this.pos = s.pos || 0; this._at = performance.now();
      this.playing = !!s.playing; this.dur = s.dur || 0; this.repeat = s.repeat || "off";
      return changed;
    }
    _state() { this.emit("state", { index: this.index, playing: this.playing, pos: this.pos, dur: this.dur }); this.emit("time", { pos: this.posNow, dur: this.dur }); }
    _cmd(c) { API.nowCmd(Object.assign({ dev: this.P.dev }, c)).catch(() => {}); }
    play() { if (this.currentId) this.P._takeover(this.queue, this.index, this.posNow); }
    pause() { this.pos = this.posNow; this._at = performance.now(); this.playing = false; this._cmd({ cmd: "pause" }); this._state(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    next() { this._cmd({ cmd: "next" }); }
    prev() { this._cmd({ cmd: "prev" }); }
    // 곡을 골라 누르기: 저쪽이 재생 중이면 저쪽에서 그 곡으로, 멈춰 있으면 이쪽에서 재생
    jump(i) { if (!this.playing) { this.P._takeover(this.queue, i, 0); return; } this.index = i; this._cmd({ cmd: "jump", i }); }
    seek(ms) { this.pos = ms; this._at = performance.now(); this._cmd({ cmd: "seek", ms: Math.round(ms) }); this.emit("time", { pos: ms, dur: this.dur }); }
    setRepeat(m) { this.repeat = m; this._cmd({ cmd: "repeat", m }); }
    // 새 목록 재생은 이 기기에서. 멈춘 채 바꾸기(꺼내기 등)는 저쪽 대기열을 바꾼다
    load(q, i, pos, autoplay) {
      if (autoplay !== false) { this.P._takeover(q, i, pos || 0); return; }
      this.queue = q.slice(); this.index = i; this.pos = pos || 0; this._at = performance.now(); this.playing = false;
      this._cmd({ cmd: "load", ids: q, index: i, pos: Math.round(pos || 0), autoplay: false, meta: this.P._meta() });
      this._state();
    }
    sync(q, i) { this.queue = q.slice(); this.index = i; this._cmd({ cmd: "sync", ids: q, index: i, meta: this.P._meta() }); }
    get volume() { return this.P.local.volume; }
    set volume(v) { this.P.local.volume = v; }
  }

  // ───── 화면이 쓰는 재생기 ─────
  class Player extends Emitter {
    constructor(getTrack) {
      super();
      this.getTrack = getTrack;
      this.native = !!window.NativeBridge;
      // 이 기기의 이름 (재생 동기화). 폰 앱은 "phone", PC 창은 처음 만든 임의 이름을 계속 쓴다
      this.dev = this.native ? "phone" : (() => {
        try { let d = localStorage.getItem("mc.dev"); if (!d) { d = "pc-" + Math.random().toString(36).slice(2, 10); localStorage.setItem("mc.dev", d); } return d; }
        catch (e) { return "pc-" + Math.random().toString(36).slice(2, 10); }
      })();
      this.owner = ""; // 소리를 내는 기기 ("" = 아직 모름·아무도 없음 → 이 기기 것을 보여 준다)
      const E = this.native ? NativeEngine : WebEngine;
      this.local = new E(getTrack);
      this.remote = new RemoteEngine(this);
      this.shuffle = false; this.original = null; this.context = null;
      this._ver = -1; this._cmdSeq = 0; this._seenMeta = 0; this._lastMeta = null; this._syncOn = false;
      // 지금 보여 주는 엔진의 소식만 화면에 넘긴다
      this.local.on("state", (s) => {
        if (this.eng !== this.local) return;
        this._adoptShuffle();
        if (s && s.playing && this._syncOn && this.owner !== this.dev) this._claim(); // 이 기기에서 소리가 나기 시작했다
        this.emit("state", s); this._save(); this._pub();
      });
      this.remote.on("state", (s) => { if (this.eng === this.remote) { this.emit("state", s); this._save(); } });
      this.local.on("time", (t) => { if (this.eng === this.local) this.emit("time", t); });
      this.remote.on("time", (t) => { if (this.eng === this.remote) this.emit("time", t); });
      this.local.on("played", (p) => this.emit("played", p));
      this.local.on("listened", (p) => this.emit("listened", p));
      this.local.on("error", (p) => this.emit("error", p));
      this.local.on("link", (p) => this.emit("link", p));
      this.local.on("native", (p) => this.emit("native", p));
      this.on("queue", () => this._pub());
      // PC가 소리를 낼 때: 재생 중이면 가끔 위치를 다시 알린다 (창을 닫으면 폰이 멈춘 것으로 본다)
      setInterval(() => { if (!this.native && this.owner === this.dev && this.local.playing) this._pub(true); }, 5000);
      this._restore();
    }
    // 소리를 내는 기기면 이 기기의 엔진, 다른 기기면 그 상태를 비추는 엔진
    get eng() { return this.owner && this.owner !== this.dev ? this.remote : this.local; }
    // 다른 기기가 소리를 내고 있으면 그 기기 이름 ("폰" / "PC"), 아니면 null
    get remoteName() { return this.owner && this.owner !== this.dev ? (this.owner === "phone" ? "폰" : "PC") : null; }

    // ───── PC·폰 재생 동기화 ─────
    _meta() { return { ctx: this.context || null, shuffle: !!this.shuffle, orig: this.original || null }; }
    _adoptMeta(m) {
      this.context = m.ctx || null; this.shuffle = !!m.shuffle; this.original = m.orig && m.orig.length ? m.orig.slice() : null;
      this._lastMeta = JSON.stringify(this._meta());
    }
    _fullState() {
      const L = this.local;
      return { ids: L.queue.slice(), index: L.index, pos: Math.round(L.posNow != null ? L.posNow : L.pos), playing: !!L.playing, dur: Math.round(L.dur || 0), repeat: L.repeat };
    }
    // 소리를 내는 기기가 상태를 알린다. 폰은 재생 서비스가 직접 알리므로 화면 쪽 정보(어디서 틀었는지·셔플)만
    _pub(now) {
      if (!this._syncOn || this.owner !== this.dev) return;
      clearTimeout(this._pubT);
      this._pubT = setTimeout(() => {
        if (this.owner !== this.dev) return;
        const b = { dev: this.dev }, m = JSON.stringify(this._meta());
        if (m !== this._lastMeta) { b.meta = this._meta(); this._lastMeta = m; }
        if (!this.native) Object.assign(b, this._fullState());
        else if (!b.meta) return;
        API.nowPublish(b).catch(() => {});
      }, now ? 0 : 120);
    }
    _claim() {
      this.owner = this.dev;
      const b = Object.assign({ dev: this.dev, meta: this._meta() }, this.native ? {} : this._fullState());
      this._lastMeta = JSON.stringify(b.meta);
      API.nowClaim(b).then((s) => this._onNow(s)).catch(() => {});
    }
    // 다른 기기에서 나던 소리를 이 기기로 가져온다 (이 기기에서 재생을 눌렀을 때)
    _takeover(q, i, pos) {
      const rep = this.remote.repeat;
      this.owner = this.dev;
      this._tellShuffle();
      this.local.setRepeat(rep);
      this.local.load(q, i, pos || 0, true);
      this._claim();
      this.emit("queue"); this.emit("state", {});
    }
    _onNow(s) {
      if (!s || s.ver == null || s.ver < this._ver) return;
      const first = this._ver < 0;
      this._ver = s.ver;
      const wasRemote = this.eng === this.remote;
      this.owner = s.owner || "";
      if (this.owner && this.owner !== this.dev) {
        // 다른 기기가 소리를 맡았다: 이쪽 소리는 멈추고 저쪽 상태를 비춘다
        if (!wasRemote && this.local.playing) this.local.pause();
        const qc = this.remote.apply(s);
        const mc = JSON.stringify({ ctx: s.ctx || null, shuffle: !!s.shuffle, orig: s.orig || null }) !== JSON.stringify(this._meta());
        this._adoptMeta({ ctx: s.ctx, shuffle: s.shuffle, orig: s.orig });
        this._seenMeta = s.metaVer || 0;
        this._cmdSeq = s.cmdSeq || 0;
        if (qc || mc || !wasRemote) this.emit("queue");
        this.emit("state", {}); this.emit("time", { pos: this.pos, dur: this.dur });
        return;
      }
      if (wasRemote) { this.emit("queue"); this.emit("state", {}); } // 소리가 이쪽으로 넘어왔다 (폰 알림의 재생 등)
      if (this.owner === this.dev) {
        // 창을 새로 열었는데 이 기기가 맡고 있던 상태가 있으면 그대로 이어 받는다 (멈춘 채)
        if (first && !this.native && s.ids && s.ids.length) {
          this._adoptMeta({ ctx: s.ctx, shuffle: s.shuffle, orig: s.orig });
          this.local.setRepeat(s.repeat || "off");
          this.local.load(s.ids, s.index, s.pos || 0, false);
          this.emit("queue"); this.emit("state", {}); this._pub(true);
        }
        // 다른 기기가 셔플·대기열을 바꿨다
        if ((s.metaVer || 0) > this._seenMeta && s.metaBy && s.metaBy !== this.dev) {
          this._adoptMeta({ ctx: s.ctx, shuffle: s.shuffle, orig: s.orig });
          this._tellShuffle();
          this.emit("queue"); this.emit("state", {});
        }
        if (!this.native && !first) for (const c of s.cmds || []) if (c.seq > this._cmdSeq) { this._cmdSeq = c.seq; this._runCmd(c); }
      }
      this._seenMeta = Math.max(this._seenMeta, s.metaVer || 0);
      this._cmdSeq = Math.max(this._cmdSeq, s.cmdSeq || 0);
    }
    // PC가 소리를 낼 때 다른 기기에서 온 조작 (폰이 소리를 낼 때는 폰의 재생 서비스가 직접 처리한다)
    _runCmd(c) {
      const L = this.local, was = L.playing;
      switch (c.cmd) {
        case "pause": L.pause(); break;
        case "play": L.play(); break;
        case "seek": L.seek(c.ms || 0); break;
        case "next": L.next(); if (!was) L.pause(); break;
        case "prev": L.prev(); if (!was) L.pause(); break;
        case "jump": L.jump(c.i); if (!was) L.pause(); break;
        case "repeat": L.setRepeat(c.m); break;
        case "sync": if (c.meta) this._adoptMeta(c.meta); L.sync(c.ids || [], c.index); this.emit("queue"); break;
        case "load": if (c.meta) this._adoptMeta(c.meta); L.load(c.ids || [], c.index || 0, c.pos || 0, !!c.autoplay); this.emit("queue"); break;
      }
      this.emit("state", {}); this._pub(true);
    }
    // 라이브러리를 불러온 뒤 한 번: 지금 재생 상태를 받아 오고, 바뀔 때마다 따라간다
    startSync() {
      if (this._syncOn || !API.now) return;
      this._syncOn = true;
      (async () => {
        let fails = 0;
        for (;;) {
          try { this._onNow(await API.now(this._ver, this._ver >= 0)); fails = 0; }
          catch (e) {
            if (API.Unauthorized && e instanceof API.Unauthorized) return;
            await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * ++fails)));
          }
        }
      })();
    }
    // 폰: 셔플 상태는 앱(위젯과 공유)이 기억한다. 화면에서 바꿀 땐 대기열을 바꾸기 전에 먼저 알린다
    _tellShuffle() {
      if (!this.native || !this.local.N.setShuffleState || this.eng !== this.local) return;
      try { this.local.N.setShuffleState(!!this.shuffle, JSON.stringify(this.original || [])); } catch (e) {}
      this.local.nShuffle = !!this.shuffle; this.local.nOrig = this.original || [];
    }
    _adoptShuffle() {
      if (!this.native || this.local.nShuffle == null || this.local.nShuffle === this.shuffle) return;
      this.shuffle = this.local.nShuffle;
      this.original = this.shuffle && this.local.nOrig && this.local.nOrig.length ? this.local.nOrig.slice() : null;
    }
    get queue() { return this.eng.queue; }
    get index() { return this.eng.index; }
    get current() { return this.getTrack(this.eng.currentId); }
    get currentId() { return this.eng.currentId; }
    get playing() { return this.eng.playing; }
    get pos() { return this.eng.posNow != null ? this.eng.posNow : this.eng.pos; }
    get dur() { return this.eng.dur || (this.current && this.current.duration) || 0; }
    get repeat() { return this.eng.repeat; }
    get volume() { return this.eng.volume; }
    set volume(v) { this.eng.volume = v; }

    // ids를 처음부터 재생. ctx는 "어디서 재생 중" 표시용 {type, id, name}
    playList(ids, start, ctx, opts) {
      ids = ids.filter((id) => this.getTrack(id));
      if (!ids.length) return;
      start = Math.max(0, Math.min(ids.length - 1, start || 0));
      this.context = ctx || null;
      const wantShuffle = opts && opts.shuffle != null ? opts.shuffle : this.shuffle;
      this.shuffle = wantShuffle;
      if (wantShuffle) {
        this.original = ids.slice();
        const fi = opts && opts.randomStart ? Math.floor(Math.random() * ids.length) : start;
        ids = [ids[fi]].concat(U.shuffle(ids.filter((_, k) => k !== fi)));
        start = 0;
      } else this.original = null;
      this._tellShuffle();
      this.eng.load(ids, start, 0, !(opts && opts.autoplay === false));
      this.emit("queue");
    }
    playOne(id, ctxIds, ctx) {
      if (ctxIds && ctxIds.length) return this.playList(ctxIds, Math.max(0, ctxIds.indexOf(id)), ctx);
      this.playList([id], 0, ctx);
    }
    // 테이프 꺼내기: 멈추고 대기열을 비운다 (재생 화면에서 테이프를 위로 끌어 올렸을 때)
    eject() {
      this.pause();
      this.context = null; this.shuffle = false; this.original = null;
      this._tellShuffle();
      this.eng.load([], 0, 0, false);
      this.emit("queue"); this.emit("state", {});
    }
    toggle() { if (this.index < 0) return; this.eng.toggle(); }
    play() { this.eng.play(); }
    pause() { this.eng.pause(); }
    next() { this.eng.next(); }
    prev() { this.eng.prev(); }
    seek(ms) { this.eng.seek(ms); }
    jump(i) { this.eng.jump(i); }
    cycleRepeat() {
      const m = { off: "all", all: "one", one: "off" }[this.repeat] || "off";
      this.eng.setRepeat(m); this.emit("state", {}); this._save();
      return m;
    }
    toggleShuffle() {
      const q = this.queue, i = this.index, cur = q[i];
      if (!cur) { this.shuffle = !this.shuffle; this._tellShuffle(); this.emit("state", {}); return this.shuffle; }
      if (!this.shuffle) {
        this.original = q.slice();
        const upcoming = U.shuffle(q.filter((_, k) => k !== i));
        this.shuffle = true; this._tellShuffle();
        this.eng.sync([cur].concat(upcoming), 0);
      } else {
        const orig = this.original && this.original.includes(cur) ? this.original : q;
        this.shuffle = false; this.original = null; this._tellShuffle();
        this.eng.sync(orig, orig.indexOf(cur));
      }
      this.emit("queue"); this.emit("state", {}); this._save();
      return this.shuffle;
    }
    playNext(ids) {
      if (this.index < 0) return this.playList(ids, 0, null);
      const q = this.queue.slice(); q.splice(this.index + 1, 0, ...ids);
      if (this.original) { this.original.push(...ids); this._tellShuffle(); }
      this.eng.sync(q, this.index); this.emit("queue"); this._save();
    }
    addToQueue(ids) {
      if (this.index < 0) return this.playList(ids, 0, null);
      const q = this.queue.concat(ids);
      if (this.original) { this.original.push(...ids); this._tellShuffle(); }
      this.eng.sync(q, this.index); this.emit("queue"); this._save();
    }
    removeAt(k) {
      if (k === this.index || k < 0 || k >= this.queue.length) return;
      const q = this.queue.slice(); const [id] = q.splice(k, 1);
      if (this.original) { const j = this.original.indexOf(id); if (j >= 0) this.original.splice(j, 1); this._tellShuffle(); }
      this.eng.sync(q, k < this.index ? this.index - 1 : this.index); this.emit("queue"); this._save();
    }
    move(from, to) {
      if (from === to) return;
      const q = this.queue.slice(); const cur = q[this.index];
      const [x] = q.splice(from, 1); q.splice(to, 0, x);
      this.eng.sync(q, q.indexOf(cur)); this.emit("queue"); this._save();
    }

    // 새로 고침해도 이어 들을 수 있게 (브라우저 쪽만. 폰은 앱이 기억함)
    _save() {
      if (this.native) return;
      try {
        localStorage.setItem("mc.queue", JSON.stringify({ q: this.queue, i: this.index, p: Math.round(this.pos), s: this.shuffle, o: this.original, r: this.repeat, c: this.context }));
      } catch (e) {}
    }
    _restore() {
      if (this.native) {
        const s = this.local.restore();
        try { const extra = JSON.parse(localStorage.getItem("mc.native.ctx") || "null"); if (extra) { this.context = extra.c; this.shuffle = !!extra.s; this.original = extra.o; } } catch (e) {}
        this._adoptShuffle(); // 앱이 기억하는 셔플(위젯에서 바꿨을 수도 있음)이 우선
        this.on("queue", () => { try { localStorage.setItem("mc.native.ctx", JSON.stringify({ c: this.context, s: this.shuffle, o: this.original })); } catch (e) {} });
        this.on("state", () => { try { localStorage.setItem("mc.native.ctx", JSON.stringify({ c: this.context, s: this.shuffle, o: this.original })); } catch (e) {} });
        return s;
      }
      this._pending = (() => { try { return JSON.parse(localStorage.getItem("mc.queue") || "null"); } catch (e) { return null; } })();
    }
    // 라이브러리를 불러온 뒤에 호출: 이전 대기열을 멈춘 상태로 되살린다
    resume() {
      const s = this._pending; this._pending = null;
      if (!s || !s.q || !s.q.length) return;
      const q = s.q.filter((id) => this.getTrack(id)); if (!q.length) return;
      const cur = s.q[s.i]; const i = Math.max(0, q.indexOf(cur));
      this.shuffle = !!s.s; this.original = s.o; this.context = s.c;
      if (s.r) this.local.setRepeat(s.r);
      this.local.load(q, i, s.p || 0, false);
      this.emit("queue");
    }
  }

  window.Player = Player;
})();
