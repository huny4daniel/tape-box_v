// 페이지: 설정·연결 (폴더, 저장 폴더, 기록 초기화, PC 가사 생성기)
"use strict";

// ───────── 페이지: 설정·연결 ─────────
pages.settings = () => {
  $("#topbar-title").textContent = "설정 · 연결";
  const N = window.NativeBridge;
  let conn;
  if (N) {
    let info = {}; try { info = JSON.parse(N.getServerInfo()); } catch (e) {}
    conn = `<div class="set-card"><div class="set-row"><div><h3>PC에서 접속</h3><p>같은 Wi-Fi에 있는 컴퓨터의 브라우저에서 이 폰의 컬렉션을 듣고 테이프를 편집할 수 있어요.</p></div><button class="switch${info.enabled ? " on" : ""}" data-act="server-toggle" aria-label="PC 접속"></button></div>
      ${info.enabled ? `<div class="addr">${(info.urls || []).map((u) => `<div><span>주소</span><b>${esc(u)}</b></div>`).join("") || `<div><span>주소</span><b>Wi-Fi에 연결되어 있지 않아요</b></div>`}<div><span>PIN</span><b class="pin-code">${esc(info.pin || "")}</b></div>${info.fingerprint ? `<div><span>인증서</span><b>${esc(info.fingerprint.slice(0, 16).toUpperCase().match(/.{4}/g).join(" "))}</b></div>` : ""}</div>
        <p style="margin-top:10px">PC 프로그램 「테이프 박스」를 실행하면 폰을 알아서 찾아요. 처음 한 번 PIN을 넣으면 돼요. 켜 둔 동안 알림이 표시돼요.</p>
        <p style="margin-top:6px">주고받는 내용은 암호화돼요. 브라우저 주소창에 위 주소를 직접 넣으면 처음에 「안전하지 않음」 경고가 나오는데, 이 폰이 직접 만든 인증서라서 그래요. 경고 화면의 인증서 지문(SHA-256) 앞부분이 위 「인증서」와 같으면 계속 진행해도 돼요.</p>` : ""}</div>`;
  } else {
    conn = `<div class="set-card"><h3>폰에 연결됨</h3><p>지금 이 화면은 폰에 저장된 컬렉션을 실시간으로 불러오고 있어요. 테이프·메모·아끼는 곡은 폰에 바로 저장돼요.</p></div>`;
  }
  return `<div class="page"><h2 style="font-size:30px;margin:8px 0 0">설정 · 연결</h2>
    ${conn}
    ${L.debug ? `<div class="set-card"><div class="set-row"><div><h3>개발용 · 원래 앱 데이터 가져오기</h3><p>이 폰에 깔린 원래 테이프 박스 앱의 수집 번호·재생 기록·아끼는 곡·메모·테이프·상자를 이 디버그 앱으로 그대로 복사해요. 디버그 앱의 지금 기록은 덮어써요. 원래 앱은 건드리지 않아요.</p></div><button class="btn" data-act="dev-import">가져오기</button></div></div>` : ""}
    <div class="set-card"><h3>기본 상자</h3><p>앱이 저절로 만들어 두는 상자예요. 숨겨도 기록은 그대로 쌓여요.</p>
      <div class="set-row" style="margin-top:12px"><div><h3 style="font-size:15px">시스템 상자</h3><p>${SYS_TAPES.map((x) => x[1]).join(" · ")}</p></div><button class="switch${sysHidden() ? "" : " on"}" data-act="box-show" data-bx="sys" aria-label="시스템 상자 보이기"></button></div>
      <div class="set-row" style="margin-top:12px"><div><h3 style="font-size:15px">히스토리 상자</h3><p>달마다 그 달에 가장 많이 들은 30곡</p></div><button class="switch${histHidden() ? "" : " on"}" data-act="box-show" data-bx="hist" aria-label="히스토리 상자 보이기"></button></div></div>
    <div class="set-card"><div class="set-row"><div><h3>만든 싱크 가사 쓰기</h3><p>${useMadeLyrics() ? "PC의 「싱크 가사 만들기」로 만든 시간 가사를 보여 줘요" : "꺼져 있어요. 음원 파일에 원래 들어 있는 가사만 보여 줘요 (만든 싱크 가사는 지우지 않고 남아 있어요)"}</p></div><button class="switch${useMadeLyrics() ? " on" : ""}" data-act="lyr-made" aria-label="만든 싱크 가사 쓰기"></button></div></div>
    <div class="set-card"><div class="set-row"><div><h3>기록 초기화</h3><p>들은 횟수, 아끼는 곡 표시, 최근 들은 기록 중 고른 것을 지워요. 수집 번호·메모·테이프·상자는 그대로 남아요.</p></div><button class="btn" data-act="reset-records">초기화…</button></div></div>
    <div class="set-card"><div class="set-row"><div><h3>라이브러리 다시 읽기</h3><p>폰에 새 곡을 넣었는데 안 보이면 눌러 주세요. 수집 번호와 기록은 그대로 남아요.</p></div><button class="btn" data-act="rescan">다시 읽기</button></div></div>
    ${N ? exportDirCard(N) : ""}
    ${N ? playlistDirCard(N) : ""}
    <div class="set-card" id="folder-card">${folderCard()}</div>
    ${N ? "" : plFileSlot()}
    ${N ? "" : lsSlot()}
    <div class="set-card"><h3>컬렉션</h3><p>${U.num(L.tracks.length)}곡 · ${U.num(L.albums.size)}장의 앨범 · ${U.num(L.artists.size)}명의 아티스트 · 테이프 ${L.playlists.length}개</p></div>
    <div class="set-card" id="ver-card"><h3>버전</h3><div class="addr"></div></div>${(setTimeout(renderVersionCard), "")}
  </div>`;
};

// ───── 버전: 폰 앱(폰 서버가 알려 준다)과, PC 프로그램 창이면 PC 프로그램 ─────
const PVA = () => (window.pywebview && window.pywebview.api && window.pywebview.api.app_version ? window.pywebview.api : null);
async function renderVersionCard() {
  const box = $("#ver-card .addr"); if (!box) return;
  const vText = (v, debug) => (v ? "v" + v : "알 수 없음") + (debug ? " (디버그)" : "");
  let phone = null, debug = false;
  try { const s = await API.status(); phone = s.version || null; debug = !!s.debug; } catch (e) {}
  const pw = PVA();
  let pc;
  if (pw) { try { pc = await pw.app_version(); } catch (e) { pc = undefined; } }
  if (!document.body.contains(box)) return; // 그새 다른 화면으로 갔다
  const rows = [`<div><span>폰 앱</span><b>${esc(vText(phone, debug))}</b></div>`];
  if (pw) rows.push(`<div><span>PC 프로그램</span><b>${esc(pc ? "v" + pc : "개발 중 (소스로 실행)")}</b></div>`);
  box.innerHTML = rows.join("")
    + (pw && pc && phone && pc !== phone ? `<p style="margin-top:10px">폰 앱과 PC 프로그램 버전이 달라요. 둘 다 같은 버전으로 업데이트해 주세요.</p>` : "");
}
window.addEventListener("pywebviewready", () => renderVersionCard());

// 다른 앱(삼성뮤직 등)이 내보낸 재생목록 파일 폴더 (폰에서만 고를 수 있다)
// 내가 만든 테이프를 고른 폴더에 .m3u8로 저장해 두고, 테이프를 고칠 때마다 따라 고친다 (상자는 하위 폴더)
function exportDirCard(N) {
  let dir = "", auto = true, hist = true; try { dir = N.getExportDir ? N.getExportDir() : ""; auto = N.getExportAuto ? N.getExportAuto() : true; hist = N.getExportHist ? N.getExportHist() : true; } catch (e) {}
  return `<div class="set-card"><div class="set-row"><div><h3>테이프를 파일로 저장</h3><p>폴더를 고르면 내가 만든 테이프를 .m3u8 재생목록 파일로 저장하고, 이름을 바꾸거나 곡을 고치거나 지울 때마다 자동으로 따라 고쳐요. 상자에 든 테이프는 상자 이름의 하위 폴더에 들어가요. 시스템 상자는 저장하지 않아요.</p></div>
    <button class="btn" data-act="export-pick">${dir ? "바꾸기" : "폴더 고르기"}</button></div>
    ${dir ? `<div class="addr"><div><span>폴더</span><b style="font-size:15px">${esc(dir)}</b></div></div>
      <div class="set-row" style="margin-top:12px"><div><h3 style="font-size:15px">자동 저장</h3><p>${auto ? "테이프를 고칠 때마다 파일도 바로 고쳐요" : "꺼져 있어요. 「지금 저장」을 누를 때만 저장해요"}</p></div><button class="switch${auto ? " on" : ""}" data-act="export-auto" aria-label="자동 저장"></button></div>
      <div class="set-row" style="margin-top:12px"><div><h3 style="font-size:15px">히스토리 상자도 저장</h3><p>${hist ? "「히스토리 상자」 하위 폴더에 달마다 파일로 남겨요 (이번 달은 듣는 대로 고쳐요)" : "꺼져 있어요. 이미 만든 히스토리 파일은 그대로 있어요"}</p></div><button class="switch${hist ? " on" : ""}" data-act="export-hist" aria-label="히스토리 상자도 저장"></button></div>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" data-act="export-now">지금 저장</button><button class="btn ghost" data-act="export-clear">폴더 해제</button></div>` : ""}</div>`;
}
function playlistDirCard(N) {
  let dir = ""; try { dir = N.getPlaylistDir ? N.getPlaylistDir() : ""; } catch (e) {}
  return `<div class="set-card"><div class="set-row"><div><h3>다른 앱 재생목록을 테이프로 가져오기</h3><p>삼성뮤직에서 내보낸 .smpl, 다른 앱의 .m3u 파일이 있는 폴더를 고르면 라이브러리를 읽을 때마다 가져와요. 이 앱에서 고친 테이프는 그대로 둬요.</p></div>
    <button class="btn" data-act="pldir-pick">${dir ? "바꾸기" : "폴더 고르기"}</button></div>
    ${dir ? `<div class="addr"><div><span>폴더</span><b style="font-size:15px">${esc(dir)}</b></div></div><div style="margin-top:10px;text-align:right"><button class="btn ghost" data-act="pldir-clear">해제</button></div>` : ""}</div>`;
}

// 라이브러리 폴더: 끈 폴더의 음악은 컬렉션에 넣지 않는다 (폰 서버가 걸러 준다)
let FD = null; // { folders:[{path,count}], off:Set, autoNew, open:Set, dirty, saving }
function loadFolders() {
  API.folders().then((r) => {
    FD = { folders: r.folders || [], off: new Set(r.off || []), autoNew: r.autoNew !== false, open: new Set(), dirty: false, saving: false };
    renderFolderCard();
  }).catch(() => { const c = $("#folder-card"); if (c) c.innerHTML = `<h3>라이브러리 폴더</h3><p>폴더 목록을 불러오지 못했어요. 폰 앱을 최신 버전으로 업데이트해 주세요.</p>`; });
}
function renderFolderCard() { const c = $("#folder-card"); if (c) c.innerHTML = folderCard(); }
const fdUnder = (path) => FD.folders.map((f) => f.path).filter((p) => p === path || (path !== "/" && p.startsWith(path)));
function folderTree() {
  const root = { kids: new Map() };
  for (const f of FD.folders) {
    const segs = f.path === "/" ? ["(저장공간 최상위)"] : f.path.split("/").filter(Boolean);
    let n = root, acc = "";
    for (const s of segs) {
      acc = f.path === "/" ? "/" : acc + s + "/";
      if (!n.kids.has(s)) n.kids.set(s, { name: s, path: acc, kids: new Map(), count: 0 });
      n = n.kids.get(s); n.count += f.count;
    }
  }
  return root;
}
function folderRows(n, depth) {
  return [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((k) => {
    const ps = fdUnder(k.path), offN = ps.filter((p) => FD.off.has(p)).length;
    const st = offN === 0 ? "on" : offN === ps.length ? "off" : "part";
    const kids = k.kids.size > 0, open = FD.open.has(k.path);
    return `<div class="fd-row" style="--d:${depth}"><button class="fd-caret" data-act="fd-open" data-path="${esc(k.path)}"${kids ? "" : " disabled"}>${kids ? `<span class="chev${open ? " open" : ""}"></span>` : ""}</button>
      <button class="fd-check ${st}" data-act="fd-check" data-path="${esc(k.path)}"><span class="box"></span><b>${esc(k.name)}</b><small>${U.num(k.count)}곡</small></button></div>${kids && open ? folderRows(k, depth + 1) : ""}`;
  }).join("");
}
function folderCard() {
  if (!FD) { setTimeout(loadFolders); return `<h3>라이브러리 폴더</h3><p>폴더 목록을 불러오는 중…</p>`; }
  const total = FD.folders.reduce((s, f) => s + f.count, 0);
  const inN = FD.folders.reduce((s, f) => s + (FD.off.has(f.path) ? 0 : f.count), 0);
  return `<h3>라이브러리 폴더</h3><p>체크를 끈 폴더의 음악은 컬렉션에 넣지 않아요. 수집 번호와 기록은 지워지지 않아서 다시 켜면 그대로 돌아와요.</p>
    <div class="fd-tree">${FD.folders.length ? folderRows(folderTree(), 0) : `<p>음악이 든 폴더가 없어요</p>`}</div>
    <div class="set-row" style="margin-top:16px"><div><h3 style="font-size:15px">새로 생긴 폴더도 자동으로 넣기</h3><p>끄면 지금 켜 둔 폴더만 읽어요. 이미 있는 폴더 안에 새로 생긴 폴더는 그 폴더 설정을 따라요.</p></div><button class="switch${FD.autoNew ? " on" : ""}" data-act="fd-auto" aria-label="새 폴더 자동으로 넣기"></button></div>
    <div class="fd-foot"><span>${U.num(total)}곡 중 <b>${U.num(inN)}곡</b>을 넣어요</span><button class="btn" data-act="fd-apply"${FD.dirty && !FD.saving ? "" : " disabled"}>${FD.saving ? "적용하는 중…" : "적용"}</button></div>`;
}

// 재생목록 추가하기: PC 프로그램 창에서만 보인다. 고른 파일은 PC가 들고 있다가(pl_pending) 폰에 하나씩 보내고,
// 폰이 받은 것만 지운다 → 폰과 연결이 끊겨 있었으면 다음에 연결될 때 마저 보낸다
const PLA = () => (window.pywebview && window.pywebview.api && window.pywebview.api.pl_pick ? window.pywebview.api : null);
let plSending = null, plLeft = 0;
function plFileSlot() { setTimeout(renderPlFileCard); return `<div class="set-card" id="plfile-card" hidden></div>`; }
window.addEventListener("pywebviewready", () => renderPlFileCard());
function renderPlFileCard() {
  const c = $("#plfile-card"); if (!c || !PLA()) return;
  c.hidden = false;
  c.innerHTML = `<div class="set-row"><div><h3>재생목록 추가하기</h3><p>이 PC의 .m3u·.m3u8 재생목록 파일을 골라(여러 개 가능) 폰에 테이프로 만들어요. 「테이프를 파일로 저장」 폴더를 골라 두었으면 그 폴더에도 넣어요. 곡은 파일 이름과 제목·아티스트로 폰 컬렉션에서 찾아요.</p></div>
    <button class="btn" data-act="plfile-add"${plSending ? " disabled" : ""}>${plSending ? "보내는 중…" : "파일 고르기"}</button></div>
    ${plLeft ? `<p class="ls-note">폰에 아직 못 보낸 파일 ${plLeft}개 · 폰과 연결되면 다시 보내요</p>` : ""}`;
}
function plFileAdd() {
  const pw = PLA(); if (!pw || plSending) return;
  pw.pl_pick().then((r) => {
    if (!r || r.cancel) return;
    if (r.errors && r.errors.length) toast("읽지 못한 파일: " + r.errors.join(", "));
    return plFlush();
  }).catch((err) => toast("실패: " + ((err && err.message) || err)));
}
// 들고 있는 파일을 폰에 보낸다. 폰이 답한 것(테이프를 만들었든, 맞는 곡이 없든)은 목록에서 빼고, 닿지 않은 것은 남긴다
function plFlush() {
  const pw = PLA(); if (!pw) return Promise.resolve();
  if (plSending) return plSending;
  plSending = (async () => {
    const items = (await pw.pl_pending()) || [];
    if (!items.length) { plLeft = 0; return; }
    renderPlFileCard();
    const done = [], made = [], bad = [];
    let lost = null;
    for (const it of items) {
      let r;
      try { r = await API.importPlaylist(it.name, it.data); }
      catch (e) { lost = e; break; } // 폰에 닿지 않음 (끊김·예전 폰 앱) → 나머지는 다음에
      done.push(it.src);
      if (r && r.ok) made.push(r); else bad.push(it.name.replace(/\.[^.]+$/, "") + " (" + ((r && r.error) || "실패") + ")");
    }
    const res = done.length ? await pw.pl_done(done) : null;
    plLeft = res ? res.pending || 0 : items.length;
    const msg = [];
    if (made.length) msg.push(made.length === 1 ? `테이프 「${made[0].name}」를 만들었어요 (${made[0].count}곡)` : `테이프 ${made.length}개를 만들었어요`);
    if (bad.length) msg.push("만들지 못함: " + bad.join(", "));
    if (lost) msg.push(lost.message === "not found" ? "폰 앱을 업데이트해야 보낼 수 있어요" : "폰에 보내지 못했어요. 연결되면 다시 보내요");
    if (msg.length) toast(msg.join(" · "));
    if (made.length) await reloadLibrary();
  })().catch(() => {}).then(() => { plSending = null; renderPlFileCard(); });
  return plSending;
}
// 시작할 때 못 보낸 파일이 남아 있으면 보낸다 (boot.js가 폰에 붙은 뒤 부른다)
function plFlushWhenReady() {
  if (window.NativeBridge) return;
  if (PLA()) plFlush(); else window.addEventListener("pywebviewready", () => plFlush(), { once: true });
}

// 싱크 가사 생성기: PC 프로그램 창(pywebview)에서만 보인다. 설치와 실행은 PC 쪽(pc/lyricsync.py)이 맡는다
const PWA = () => (window.pywebview && window.pywebview.api && window.pywebview.api.ls_state ? window.pywebview.api : null);
const LS_TABS = [["made", "만든 곡"], ["check", "확인 필요"], ["fail", "실패"], ["skip", "건너뛴 곡"], ["rejected", "되돌린 곡"], ["notfound", "폰에서 못 찾음"]];
const LS_STATUS = { done: "만듦", kept: "괜찮음", restored: "사본으로 되살림", check: "확인 필요", fail: "실패", skip: "건너뜀", rejected: "되돌림" };
const LS_MAX = 300; // 목록에 한 번에 그리는 수 (더 많으면 검색으로 좁힌다)
let LS = null, lsTimer = 0, lsHtml = "", lsHeadHtml = "";
let LSR = { tab: null, items: null, q: "", loading: false }; // 펼친 결과 목록
function lsSlot() {
  lsHtml = lsHeadHtml = ""; LSR.items = null; setTimeout(() => { lsPoll(); lsSync().then((r) => { if (r && r.count) lsPoll(); }); });
  return `<div class="set-card" id="ls-card" hidden><div id="ls-main"></div><div id="ls-results"><div id="ls-results-head"></div><div id="ls-filter"></div><div id="ls-rows"></div></div></div>`;
}
window.addEventListener("pywebviewready", () => lsPoll());
function lsPoll() {
  clearTimeout(lsTimer);
  const pw = PWA();
  if (!$("#ls-card") || !pw) return;
  pw.ls_state().then((st) => { LS = st; renderLsCard(); }).catch(() => {})
    .then(() => { if ($("#ls-card")) lsTimer = setTimeout(lsPoll, LS && LS.phase !== "idle" ? 1000 : 5000); });
}
function renderLsCard() {
  const c = $("#ls-card"); if (!c || !LS) return;
  c.hidden = false;
  const html = lsCard(LS);
  if (html !== lsHtml) { $("#ls-main").innerHTML = html; lsHtml = html; }
  const head = lsResultsHead(LS);
  if (head !== lsHeadHtml) { $("#ls-results-head").innerHTML = head; lsHeadHtml = head; }
  // 펼친 목록의 곡 수가 바뀌면(생성 중이거나 정리했을 때) 다시 불러온다
  const k = lsKind(), cnt = LS.counts || {};
  const n = k === "all" ? LS_TABS.reduce((s, [t]) => s + (t === "notfound" ? 0 : cnt[t] || 0), 0) : k ? cnt[k] || 0 : 0;
  if (k && !LSR.loading && (!LSR.items || LSR.items.length !== n)) lsLoadList();
  renderLsFilter();
}
// 지금 보여 줄 결과 종류: 고른 탭, 탭 없이 검색 중이면 전체
const lsKind = () => LSR.tab || (LSR.q.trim() ? "all" : null);
function lsCard(st) {
  const r = st.run, sd = st.send, c = st.counts || {};
  const rows = [`<div><span>생성 도구 위치</span><b style="font-size:14px">${st.home ? esc(st.home) : "아직 고르지 않았어요"}</b></div>`];
  if (st.parent && st.freeGb != null) rows.push(`<div><span>남은 공간</span><b style="font-size:14px">${st.freeGb}GB</b></div>`);
  if (st.installed) rows.push(`<div><span>계산 장치</span><b style="font-size:14px">${st.device === "cuda" ? esc(st.gpu || "NVIDIA GPU") : "CPU (GPU보다 많이 느려요)"}</b></div>`);
  let body = "", btns = "";
  const idle = st.phase === "idle";
  if (st.phase === "installing" || st.phase === "removing") {
    body = `<p class="ls-step">${esc(st.step)}</p>${st.log.length ? `<pre class="ls-log">${esc(st.log.slice(-3).join("\n"))}</pre>` : ""}`;
    btns = st.phase === "installing" ? `<button class="btn ghost" data-act="ls-stop">멈춤</button>` : "";
  } else if (st.outdated) {
    body = `<p class="ls-note">새 버전에 맞게 생성 도구를 업데이트해야 해요. 이미 받은 것은 그대로 두고 필요한 것만 받아서 금방 끝나요.</p>`;
    btns = `<button class="btn" data-act="ls-install">생성 도구 업데이트</button>`;
  } else if (!st.installed) {
    body = `<p class="ls-note">싱크 가사를 만드는 생성 도구(실행 환경과 음성 모델)를 처음 한 번 이 PC에 설치해요. 고른 폴더 안에만 설치되고, 설치하는 동안 ${st.needGb}GB, 끝나면 7GB 정도를 써요. NVIDIA 그래픽카드가 있으면 곡당 20초 안팎, 없으면 몇 분씩 걸려요.</p>`;
    btns = `<button class="btn ghost" data-act="ls-pick">${st.parent ? "도구 위치 바꾸기" : "도구 설치 위치 고르기"}</button><button class="btn" data-act="ls-install"${st.parent ? "" : " disabled"}>생성 도구 설치</button>`;
  } else if (st.phase === "running") {
    const pct = r && r.total ? Math.round((r.i / r.total) * 100) : 0;
    const avg = r && r.secs.length ? Math.round(r.secs.reduce((a, b) => a + b, 0) / r.secs.length) : 0;
    body = `<div class="ls-bar"><i style="width:${pct}%"></i></div>
      <p class="ls-step">${r && r.total ? `${U.num(r.i)} / ${U.num(r.total)}곡 살펴봄` : esc(st.step || "준비하는 중…")}${avg ? ` · 곡당 약 ${avg}초` : ""}</p>
      ${r && r.current ? `<p class="ls-note">만드는 중: ${esc(r.current.title)}${r.current.artist ? " — " + esc(r.current.artist) : ""}</p>` : st.step && r && r.total ? `<p class="ls-note">${esc(st.step)}</p>` : ""}
      ${lsCounts(r)}`;
    btns = `<button class="btn ghost" data-act="ls-stop">멈춤</button>`;
  } else if (st.phase === "sending") {
    const pct = sd && sd.total ? Math.round((sd.i / sd.total) * 100) : 0;
    body = `<div class="ls-bar"><i style="width:${pct}%"></i></div><p class="ls-step">${sd && sd.total ? `폰에 보내는 중 · ${U.num(sd.i)} / ${U.num(sd.total)}곡` : esc(st.step || "준비하는 중…")}</p>`;
    btns = `<button class="btn ghost" data-act="ls-stop">멈춤</button>`;
  } else {
    // 만드는 방식
    const folder = st.source !== "phone";
    body = `<div class="ls-source"><button class="ls-tab${folder ? " on" : ""}" data-act="ls-source" data-v="folder">PC에 복사한 음원 폴더로</button><button class="ls-tab${folder ? "" : " on"}" data-act="ls-source" data-v="phone">폰에서 바로 받아서</button></div>
      <p class="ls-note">${folder
        ? "폰의 음악 폴더를 이 PC로 복사해 두고 그 폴더로 만들어요. 만드는 동안 폰이 필요 없어서 끊기지 않아요. 다 만든 뒤 「폰에 보내기」를 누르면 폰에 저장돼요."
        : "폰에서 곡을 하나씩 받아 만들고 바로 폰에 저장해요. 몇 곡만 새로 넣었을 때 편해요. 만드는 동안 폰과 연결돼 있어야 하고, 끊기면 다시 연결되길 기다려요."}</p>
      ${folder ? `<div class="addr"><div><span>음원 폴더</span><b style="font-size:14px">${st.musicDir ? esc(st.musicDir) + (st.musicOk ? "" : " (찾을 수 없음)") : "아직 고르지 않았어요"}</b></div></div>` : ""}
      ${r && r.finished ? `<p class="ls-step">${r.stopped ? "멈췄어요" : "다 살펴봤어요"}</p>${lsCounts(r)}` : ""}
      ${folder && c.pending ? `<p class="ls-step">폰에 보낼 곡 ${U.num(c.pending)}곡</p><p class="ls-note">폰 앱을 켜고 PC와 연결된 상태에서 「폰에 보내기」를 눌러 주세요. 금방 끝나요.</p>` : ""}`;
    btns = `<button class="btn ghost" data-act="ls-remove">생성 도구 지우기</button>`
      + (folder ? `<button class="btn ghost" data-act="ls-pick-music">${st.musicDir ? "음원 폴더 바꾸기" : "음원 폴더 고르기"}</button>` : "")
      + (folder && c.pending ? `<button class="btn" data-act="ls-send">폰에 보내기</button>` : "")
      + `<button class="btn" data-act="ls-start"${folder && !st.musicOk ? " disabled" : ""}>${r ? "다시 시작" : "시작"}</button>`;
  }
  return `<h3>싱크 가사 만들기</h3><p>가사는 있는데 시간 정보가 없는 곡을, 이 PC가 음원에 맞춰 시간 가사로 만들어 폰에 저장해요. 가사 글은 파일에 있던 그대로 쓰고, 원본 파일은 바꾸지 않아요.</p><p style="margin-top:6px">만든 싱크 가사는 폰에 저장되고, 아래 생성 도구 폴더에는 다시 보내거나 되살릴 사본이 남아요.</p>
    <div class="addr">${rows.join("")}</div>${body}
    ${st.error ? `<p class="ls-err">${esc(st.error)}</p>` : st.notice && idle ? `<p class="ls-step">${esc(st.notice)}</p>` : ""}
    <div class="ls-btns">${btns}</div>`;
}
function lsCounts(r) {
  if (!r) return "";
  const parts = [["이번에 만듦", r.done + r.check], ["확인 필요", r.check], ["실패", r.fail], ["사본으로 되살림", r.restored], ["건너뜀", r.skip]].filter(([, n]) => n > 0);
  return parts.length ? `<p class="ls-note">${parts.map(([k, n]) => `${k} <b>${U.num(n)}</b>`).join(" · ")}</p>` : "";
}
// ── 결과 목록: 지난 실행까지 합친 곡별 마지막 결과 ──
function lsResultsHead(st) {
  const c = st.counts || {};
  if (!LS_TABS.some(([k]) => c[k])) return "";
  return `<div class="ls-tabs"><span>결과 목록</span>${LS_TABS.filter(([k]) => k !== "notfound" || c[k]).map(([k, label]) => `<button class="ls-tab${LSR.tab === k ? " on" : ""}" data-act="ls-tab" data-v="${k}">${label} <b>${U.num(c[k] || 0)}</b></button>`).join("")}
    ${st.phase === "idle" ? `<button class="ls-reset" data-act="ls-reset">결과 기록 지우기</button>` : ""}</div>`;
}
const LS_TAB_NOTE = {
  made: "싱크 가사를 만들어 폰에 저장한 곡이에요. 정규 음원이 아니거나 틀린 곡은 「되돌리기」로 원래 가사로 돌릴 수 있어요.",
  check: "만들어서 저장은 했지만 어긋났을 수 있는 곡이에요. 재생해 보고 괜찮으면 「괜찮아요」, 틀렸으면 「되돌리기」를 눌러 주세요.",
  fail: "만들지 못한 곡이에요. 다음에 시작하면 다시 시도해요.",
  skip: "만들 필요가 없거나 만들 수 없어서 지나간 곡이에요. 이 도구는 파일에 있는 가사 글에 시간만 붙이므로, 가사가 없는 곡은 만들 수 없어요.",
  rejected: "되돌려서 원래 가사로 돌아간 곡이에요. 다음에 시작해도 다시 만들지 않아요. 「다시 만들기」를 누르면 다음 실행 때 다시 만들어요.",
  notfound: "만들었지만 폰 곡 목록에서 같은 곡을 찾지 못해 보내지 못한 곡이에요. 폰에 없는 곡이거나, PC 파일과 폰 파일의 제목·길이가 달라요.",
};
// 폰의 가사 화면에서 되돌린 곡을 PC 결과 기록에 반영한다
function lsSync() {
  const pw = PWA(); if (!pw || !pw.ls_sync) return Promise.resolve(null);
  return lsToken().then((tok) => (tok ? pw.ls_sync(location.origin, tok) : null)).catch(() => null);
}
function lsLoadList() {
  const pw = PWA(), tab = lsKind(); if (!pw || !tab) return;
  LSR.loading = true;
  lsSync().then(() => pw.ls_results(tab)).then((items) => { if (lsKind() === tab) { LSR.items = items || []; renderLsRows(); } })
    .catch(() => {}).then(() => { LSR.loading = false; });
}
// 검색창은 결과가 하나라도 있으면 늘 보인다 (탭을 고르지 않으면 모든 결과에서 찾는다). 입력 중에 다시 그리지 않게 한 번만 만든다
function renderLsFilter() {
  const f = $("#ls-filter"); if (!f) return;
  if (!lsHeadHtml) { f.innerHTML = ""; return; }
  if (!$("[data-ls-filter]", f)) f.innerHTML = `<input class="ls-search" type="search" data-ls-filter placeholder="결과에서 곡·아티스트·이유로 찾기 (초성도)" autocomplete="off" spellcheck="false" value="${esc(LSR.q)}"><p class="ls-note" data-ls-note></p>`;
  const note = $("[data-ls-note]", f), txt = LSR.tab ? LS_TAB_NOTE[LSR.tab] : "";
  note.textContent = txt; note.hidden = !txt;
}
// 곡 이름·아티스트·이유·경로에서 찾는다. 자음만 치면 초성으로
function lsMatch(o, q) {
  const hay = U.norm(`${o.title || ""} ${o.artist || ""} ${o.reason || ""} ${o.path || ""}`);
  return U.isChoQuery(q) ? U.chosung(hay).includes(U.norm(q)) : hay.includes(U.norm(q));
}
function renderLsRows() {
  const box = $("#ls-rows"); if (!box) return;
  if (!lsKind()) { box.innerHTML = ""; return; }
  if (!LSR.items) { box.innerHTML = `<p class="ls-note">불러오는 중…</p>`; return; }
  const q = LSR.q.trim();
  const all = q ? LSR.items.filter((o) => lsMatch(o, q)) : LSR.items;
  const shown = all.slice(0, LS_MAX);
  let top = "";
  if (LSR.tab === "skip" && !q) { // 이유별로 몇 곡인지
    const by = new Map(); LSR.items.forEach((o) => by.set(o.reason || "", (by.get(o.reason || "") || 0) + 1));
    top = `<p class="ls-note">${[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k || "기타")} <b>${U.num(n)}</b>`).join(" · ")}</p>`;
  }
  if (LSR.tab === "check" && LSR.items.length) top += `<div class="ls-btns" style="margin-top:10px"><button class="btn ghost" data-act="ls-revert-all">확인 필요 곡 모두 되돌리기</button></div>`;
  if (!LSR.tab && q) top = `<p class="ls-note">모든 결과에서 <b>${U.num(all.length)}</b>곡</p>`;
  box.innerHTML = top + (shown.length ? shown.map(lsRow).join("") : `<p class="ls-note">${q ? "찾는 곡이 없어요" : "아직 없어요"}</p>`)
    + (all.length > shown.length ? `<p class="ls-note">외 ${U.num(all.length - shown.length)}곡 — 검색으로 좁혀 보세요</p>` : "");
}
function lsRow(o) {
  const id = esc(o.id), st = o.status;
  const b = (act, label) => `<button class="btn ghost" data-act="${act}" data-id="${id}">${label}</button>`;
  const btns = st === "check" ? b("ls-keep", "괜찮아요") + b("ls-revert", "되돌리기")
    : st === "done" || st === "kept" || st === "restored" ? b("ls-revert", "되돌리기")
    : st === "rejected" ? b("ls-retry", "다시 만들기") : "";
  const pid = o.phoneId && L.byId.has(o.phoneId) ? o.phoneId : null; // 폰에 있는 곡이면 곡 화면으로
  const name = esc(o.title || o.path || o.id);
  return `<div class="ls-check">${pid ? `<a href="#/track/${encodeURIComponent(pid)}">${name}</a>` : `<b class="ls-name">${name}</b>`}<small>${esc(o.artist || "")}</small>
    <em class="${st}">${LS_STATUS[st] || st}${o.reason ? " · " + esc(o.reason) : ""}${o.path ? ` · <span class="ls-path">${esc(o.path)}</span>` : ""}</em>${btns ? `<span class="ls-check-btns">${btns}</span>` : ""}</div>`;
}
document.addEventListener("input", (e) => {
  if (!e.target.matches || !e.target.matches("[data-ls-filter]")) return;
  const before = lsKind();
  LSR.q = e.target.value;
  if (lsKind() !== before) { LSR.items = null; lsLoadList(); } // 탭 없이 검색을 시작하거나 지웠을 때
  renderLsRows();
});
// 폰 연결이 필요 없는 작업은 토큰 없이 (PC 폴더 방식은 폰이 꺼져 있어도 만든다)
const lsToken = () => API.token().then((t) => t.token).catch(() => "");
function lsAct(act, el) {
  const pw = PWA(); if (!pw) return;
  const done = (res) => { if (res && res.ok === false && !res.cancel) toast(res.error || "실패했어요"); lsHtml = ""; lsPoll(); };
  const fail = (err) => { toast("실패: " + ((err && err.message) || err)); lsPoll(); };
  const reloadList = () => { LSR.items = null; renderLsRows(); lsLoadList(); };
  if (act === "ls-tab") {
    const v = el.dataset.v;
    LSR = { tab: LSR.tab === v ? null : v, items: null, q: LSR.q, loading: false };
    lsHeadHtml = ""; renderLsCard(); renderLsFilter(); renderLsRows();
    if (lsKind()) lsLoadList();
    return;
  }
  if (act === "ls-revert" || act === "ls-keep" || act === "ls-retry" || act === "ls-revert-all") {
    const ids = act === "ls-revert-all" ? (LSR.items || []).filter((o) => o.status === "check").map((o) => o.id) : [el.dataset.id];
    if (!ids.length) return;
    if (act === "ls-revert-all" && !confirm(`확인 필요 곡 ${ids.length}곡의 만든 가사를 지우고 원래 가사로 되돌릴까요?\n되돌린 곡은 다시 만들지 않아요.`)) return;
    const action = act === "ls-keep" ? "keep" : act === "ls-retry" ? "retry" : "revert";
    el.disabled = true;
    (action === "retry" ? Promise.resolve("") : lsToken()) // 괜찮음 표시도 폰의 되돌리기 버튼을 떼려고 폰에 알린다
      .then((tok) => pw.ls_review(location.origin, tok, ids, action))
      .then((res) => {
        if (res && res.ok) toast(action === "revert" ? `${U.num(res.count)}곡을 원래 가사로 되돌렸어요` : action === "retry" ? "다음에 시작하면 다시 만들어요" : "괜찮은 곡으로 옮겼어요");
        if (action === "revert") lyrCache.clear(); // 가사 화면이 새로 불러오게
        reloadList(); done(res);
      }, fail);
    return;
  }
  if (act === "ls-reset") {
    if (!confirm("결과 기록을 모두 지우고 처음부터 다시 할까요?\n\n· 결과 목록과 PC에 남긴 가사 사본을 지워요\n· 폰에 저장된 만든 싱크 가사도 모두 지워요 (파일에 원래 있던 가사는 그대로예요)\n· 생성 도구와 음원 파일은 지우지 않아요")) return;
    lsToken().then((tok) => pw.ls_reset(location.origin, tok)).then((res) => {
      if (res && res.ok) toast(res.phone ? "결과 기록과 폰의 만든 싱크 가사를 지웠어요" : "결과 기록을 지웠어요. 폰에 연결되지 않아 폰의 만든 싱크 가사는 지우지 못했어요");
      lyrCache.clear(); LSR = { tab: null, items: null, q: "", loading: false }; lsHeadHtml = ""; $("#ls-filter").innerHTML = ""; renderLsFilter(); renderLsRows(); done(res);
    }, fail);
    return;
  }
  if (act === "ls-source") pw.ls_set_source(el.dataset.v).then(done, fail);
  else if (act === "ls-pick") pw.ls_pick_dir().then(done, fail);
  else if (act === "ls-pick-music") pw.ls_pick_music().then(done, fail);
  else if (act === "ls-install") pw.ls_install().then(done, fail);
  else if (act === "ls-stop") pw.ls_stop().then(done, fail);
  else if (act === "ls-remove") { if (confirm("생성 도구(실행 환경과 모델)를 지울까요?\n폰에 저장된 싱크 가사와 PC에 남긴 사본은 지우지 않아요.")) pw.ls_remove().then(done, fail); }
  else if (act === "ls-start") lsToken().then((tok) => pw.ls_start(location.origin, tok)).then(done, fail);
  else if (act === "ls-send") lsToken().then((tok) => pw.ls_send(location.origin, tok)).then((res) => { lyrCache.clear(); done(res); }, fail);
}

const notFound = () => `<div class="page"><div class="empty"><b>찾을 수 없어요</b>컬렉션에서 빠진 항목일 수 있어요.</div></div>`;
