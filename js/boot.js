// 시작: 라이브러리를 읽고 재생기를 붙인 뒤 첫 화면을 그린다
"use strict";

// ───────── 시작 ─────────
// 상자를 모르는 예전 폰 앱이면 상자 없이
const loadBoxes = () => API.boxes().then((b) => b || []).catch(() => []);
const loadHistory = () => (API.history ? API.history() : Promise.resolve([])).then((h) => (L.history = Array.isArray(h) ? h : [])).catch(() => (L.history = []));
// 폰 DB에 둔 화면 상태(정렬 등)를 화면 변수에 옮긴다
const applyPrefs = () => { Object.assign(libSort, Prefs.get("libSort", {})); Object.assign(colState, Prefs.get("col", {})); };
// 테이프 저장 폴더의 파일을 밖에서 고쳤으면 반영해 다시 읽는다. 시작할 때와, PC 창으로 돌아올 때 (폰 앱은 폰이 알려 준다)
let pullAt = 0;
function pullFiles() {
  if (!API.syncFiles || Date.now() - pullAt < 5000) return;
  pullAt = Date.now();
  API.syncFiles().then((r) => { if (r && r.changed) { reloadLibrary(); toast("저장 폴더에서 고친 테이프를 반영했어요"); } }).catch(() => {});
}
window.addEventListener("focus", () => { if (!window.NativeBridge) pullFiles(); });
async function reloadLibrary() {
  const [lib, pls, bxs] = await Promise.all([API.library(), API.playlists(), loadBoxes(), loadHistory(), Prefs.load()]);
  applyPrefs();
  indexLibrary(lib.tracks || []); L.playlists = pls || []; L.boxes = bxs;
  renderSidebar(); rerender(); renderBar();
}
// 개발 (디버그 앱 + PC 개발 서버 pc/dev_proxy.py): 화면 파일이 바뀌면 CSS만일 땐 스타일만 갈아 끼우고(재생·화면 그대로),
// 그 밖의 파일이면 새로고침한다. 개발 서버가 없으면 조용히 기다렸다가 다시 붙는다
function devWatch() {
  let v = "", fails = 0;
  const swapCss = (nv) => $$('link[rel="stylesheet"][href^="css/"]').forEach((l) => {
    const n = l.cloneNode(); n.href = l.getAttribute("href").split("?")[0] + "?v=" + nv;
    n.onload = () => l.remove(); l.after(n); // 새 스타일이 다 읽힌 뒤 옛것을 빼서 깜빡이지 않게
  });
  const loop = () => fetch("/__dev/wait?v=" + v, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((o) => {
      fails = 0;
      if (v && o.v !== v) {
        if (!o.css) { location.reload(); return; }
        swapCss(o.v); toast("스타일을 새로 읽었어요");
      }
      v = o.v; loop();
    })
    .catch(() => setTimeout(loop, Math.min(30000, 2000 * ++fails)));
  loop();
}
async function boot() {
  try {
    const st = await API.status();
    L.debug = !!st.debug;
    if (L.debug) devWatch();
    if (!st.authorized) return showGate();
    const [lib, pls, bxs] = await Promise.all([API.library(), API.playlists(), loadBoxes(), loadHistory(), Prefs.load()]);
    indexLibrary(lib.tracks || []); L.playlists = pls || []; L.boxes = bxs; applyPrefs();
    pullFiles();
  } catch (e) {
    if (e instanceof API.Unauthorized) return showGate();
    $("#view").innerHTML = `<div class="page"><div class="empty"><b>폰에 연결할 수 없어요</b>폰 앱에서 「PC에서 접속」이 켜져 있는지, 같은 Wi-Fi인지 확인해 주세요.<br><br><button class="btn" onclick="location.reload()">다시 시도</button></div></div>`;
    return;
  }
  P = new Player((id) => L.byId.get(id));
  // 새로 재생을 시작하면 (PC·폰 모두) 카세트 재생 화면으로 바로 넘어간다
  const playList = P.playList.bind(P);
  P.playList = (...args) => { playList(...args); if (fp.hidden) openFull(); };
  P.on("state", onState);
  // 테이프를 '들었다'고 치는 기준: 한 곡을 실제로 10초 들으면 (곡 재생 횟수 기준과는 따로).
  // 재생 시간 알림(time)은 PC·폰 모두 오므로 여기서 직접 센다. 화면이 잠들어 못 센 경우를 위해 곡 재생 횟수 기록 때도 한 번 더
  const TAPE_MS = 10000;
  let tl = { key: null, ms: 0, last: 0, done: false };
  P.on("time", () => {
    const c = P.context, k = (P.currentId || "") + "|" + JSON.stringify(c ? [c.type, c.id || "", c.name || ""] : null), now = performance.now();
    if (tl.key !== k) tl = { key: k, ms: 0, last: now, done: false };
    if (P.playing) tl.ms += Math.min(1500, Math.max(0, now - tl.last)); // 탐색·일시정지 시간은 넣지 않는다
    tl.last = now;
    if (!tl.done && tl.ms >= TAPE_MS) { tl.done = true; markTapePlayed(); }
  });
  P.on("played", markTapePlayed);
  P.on("played", U.debounce(() => loadHistory().then(() => { renderSidebar(); if (["box", "playlist"].includes(route().name) && /^(hist|hist-)/.test(route().arg)) rerender(); }), 1500)); // 이번 달 히스토리 테이프
  P.on("queue", () => {
    if (panelOpen && panelTab === "queue") renderPanel(); if (npSide === "queue") renderNpSide();
    refreshHomeNow();
    // 폰 홈 화면 위젯의 카세트에도 같은 테이프 이름을 적는다
    syncWidgetName();
  });
  P.on("time", updateTime);
  P.on("played", onPlayed);
  P.on("listened", ({ id, ms }) => { const t = L.byId.get(id); if (t) t.listenedMs += ms; });
  P.on("error", () => toast("이 곡을 재생하지 못했어요"));
  let linkLost = false;
  P.on("link", ({ ok }) => {
    if (!ok && !linkLost) { linkLost = true; toast("폰 연결이 끊겼어요. 다시 연결되면 이어서 재생해요"); }
    else if (ok && linkLost) { linkLost = false; toast("폰과 다시 연결됐어요"); }
  });
  P.on("native", (m) => { if (m.type === "exportdir") { if (route().name === "settings") rerender(); toast("고른 폴더에 테이프를 저장해요"); } if (m.type === "library") reloadLibrary(); if (m.type === "resume") reloadLibrary().catch(() => {}); });
  renderSidebar();
  P.resume();
  render();
  onState();
  renderPanel();
  window.addEventListener("resize", U.debounce(() => { renderBar(); }, 200));
}
function showGate() {
  const g = $("#gate"); g.hidden = false;
  g.innerHTML = `<div class="gate-box"><div class="brand-mark"></div><h1>폰의 컬렉션에 연결</h1><p>폰 앱 「설정 · 연결」에 보이는 PIN 6자리를 입력해 주세요</p>
    <div class="pin">${"<input inputmode=numeric maxlength=1>".repeat(6)}</div><div class="gate-err"></div></div>`;
  const ins = $$(".pin input", g); ins[0].focus();
  ins.forEach((inp, i) => {
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(-1);
      if (inp.value && i < 5) ins[i + 1].focus();
      const pin = ins.map((x) => x.value).join("");
      if (pin.length === 6) API.pair(pin).then(() => { g.hidden = true; boot(); }).catch((e) => { $(".gate-err", g).textContent = e.message === "locked" ? "잠시 뒤에 다시 시도해 주세요" : "PIN이 맞지 않아요"; ins.forEach((x) => (x.value = "")); ins[0].focus(); });
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && i > 0) ins[i - 1].focus(); });
    inp.addEventListener("paste", (e) => { const s = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (s.length) { e.preventDefault(); s.split("").forEach((c, k) => (ins[k].value = c)); ins[Math.min(5, s.length)].dispatchEvent(new Event("input")); } });
  });
}

boot();
