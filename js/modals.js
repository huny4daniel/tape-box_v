// 메뉴·모달·토스트, 테이프·상자 고치기 창
"use strict";

// ───────── 메뉴·모달·토스트 ─────────
const menu = $("#menu");
function openMenu(x, y, html) {
  menu.innerHTML = `<div class="menu-box">${html}</div>`;
  menu.hidden = false;
  const box = menu.firstChild; const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  box.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
}
function closeMenu() { menu.hidden = true; menu.innerHTML = ""; }
menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });
function trackMenu(id, x, y, ctx) {
  const t = L.byId.get(id); if (!t) return;
  const inPl = ctx && ctx.list === "playlist" && !isSysTape(route().arg); // 시스템·히스토리 테이프는 곡을 뺄 수 없다
  const tapeGo = ctx && ctx.np ? nowTapeHref() : null; // 재생 화면: 지금 듣는 테이프로
  openMenu(x, y, `
    <div class="mh">${art(t, 100)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>
    <button data-m="next" data-id="${esc(id)}"><i class="ic ic-queue"></i>다음에 재생</button>
    <button data-m="queue" data-id="${esc(id)}"><i class="ic ic-plus"></i>대기열 맨 뒤에 추가</button>
    <button data-m="addpl" data-id="${esc(id)}"><i class="ic ic-stack"></i>테이프에 담기…</button>
    <button data-m="fav" data-id="${esc(id)}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i>${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}</button>
    ${inPl ? `<button data-m="plremove" data-id="${esc(id)}" data-i="${ctx.i}" class="danger"><i class="ic ic-x"></i>이 테이프에서 빼기</button>` : ""}
    <hr>
    ${tapeGo ? `<button data-m="go" data-href="${tapeGo}"><i class="ic ic-tape"></i>테이프 상세보기</button>` : ""}
    <button data-m="go" data-href="#/track/${encodeURIComponent(id)}"><i class="ic ic-shelf"></i>곡 상세보기</button>
    ${t.album ? `<button data-m="go" data-href="${albumHref(t)}"><i class="ic ic-stack"></i>앨범으로 이동</button>` : ""}
    ${t._artists.map((a) => `<button data-m="go" data-href="#/artist/${encodeURIComponent(a)}"><i class="ic ic-home"></i>${esc(a)}</button>`).join("")}`);
}
menu.addEventListener("click", (e) => {
  const b = e.target.closest("[data-m]"); if (!b) return;
  const id = b.dataset.id; closeMenu();
  switch (b.dataset.m) {
    case "next": P.playNext([id]); toast("다음에 재생해요"); break;
    case "queue": P.addToQueue([id]); toast("대기열에 추가했어요"); break;
    case "addpl": addToPlaylistModal([id]); break;
    case "fav": toggleFav(id); break;
    case "plremove": { const p = curPlaylist(); if (p) { const items = p.items.slice(); items.splice(+b.dataset.i, 1); savePlaylist(p, { items }); } break; }
    case "go": closeFull(); location.hash = b.dataset.href; break;
    case "pl-rename": playlistModal(curPlaylist()); break;
    case "pl-decor": decorModal(curPlaylist()); break;
    case "pl-delete": deletePlaylist(curPlaylist()); break;
    case "pl-queue": { const p = curPlaylist(); if (p) { P.addToQueue(p.items.filter((i) => L.byId.has(i))); toast("대기열에 추가했어요"); } break; }
    case "tape-open": location.hash = tapeHref({ id: b.dataset.pl }); break;
    case "tape-play": playTape(b.dataset.pl); break;
    case "sys-play": playSysTape(b.dataset.k); break;
    case "album-play": case "album-shuffle": { const al = L.albums.get(b.dataset.album); if (al) P.playList(al.tracks.map((t) => t.id), 0, { type: "album", id: al.key, name: al.title }, { shuffle: b.dataset.m === "album-shuffle", randomStart: b.dataset.m === "album-shuffle" }); break; }
    case "album-queue": { const al = L.albums.get(b.dataset.album); if (al) { P.addToQueue(al.tracks.map((t) => t.id)); toast("대기열에 추가했어요"); } break; }
    case "tape-box": pickBoxModal(b.dataset.pl); break;
    case "tape-unbox": { const pl = tapeById(b.dataset.pl), bx = boxOf(b.dataset.pl); moveTapes([b.dataset.pl], null); if (pl && bx) toast(`「${pl.name}」을(를) 「${bx.name}」 상자에서 꺼냈어요`); break; }
    case "box-rename": boxModal(curBox()); break;
    case "box-hide": { setBoxHidden(b.dataset.bx, true); renderSidebar(); toast("숨겼어요. 설정 → 「기본 상자」에서 다시 보이게 할 수 있어요"); location.hash = "#/playlists"; break; }
    case "box-delete": deleteBox(curBox()); break;
    case "box-queue": { const bx = curBox(); if (bx) { P.addToQueue(boxTrackIds(bx)); toast("대기열에 추가했어요"); } break; }
  }
});
const curPlaylist = () => { const r = route(); return r.name === "playlist" ? L.playlists.find((p) => p.id === r.arg) : null; };
const curBox = () => { const r = route(); return r.name === "box" ? allBoxes().find((b) => b.id === r.arg) : null; };
// 테이프 메뉴 (꾹 누르기·오른쪽 클릭): 상세보기, 상자에 넣기·옮기기·꺼내기
function tapeMenu(plId, x, y) {
  const pl = tapeById(plId); if (!pl) return;
  const bx = boxOf(plId);
  if (isSysTape(plId)) { // 시스템·히스토리 테이프는 상자를 옮길 수 없다
    openMenu(x, y, `<div class="mh"><div><b>${esc(pl.name)}</b><span>${bx ? `「${esc(bx.name)}」 안` : "숨긴 상자"} · ${pl.items.length}곡</span></div></div>
      <button data-m="tape-play" data-pl="${esc(plId)}"><i class="ic ic-play"></i>재생하기</button>
      <button data-m="tape-open" data-pl="${esc(plId)}"><i class="ic ic-tape"></i>테이프 상세보기</button>`);
    return;
  }
  openMenu(x, y, `<div class="mh"><div><b>${esc(pl.name)}</b><span>${bx ? `「${esc(bx.name)}」 상자 안` : "상자 밖"} · ${pl.items.length}곡</span></div></div>
    <button data-m="tape-play" data-pl="${esc(plId)}"><i class="ic ic-play"></i>재생하기</button>
    <button data-m="tape-open" data-pl="${esc(plId)}"><i class="ic ic-tape"></i>테이프 상세보기</button>
    <button data-m="tape-box" data-pl="${esc(plId)}"><i class="ic ic-box"></i>${bx ? "다른 상자로 옮기기…" : "상자에 넣기…"}</button>
    ${bx ? `<button data-m="tape-unbox" data-pl="${esc(plId)}"><i class="ic ic-x"></i>상자에서 꺼내기</button>` : ""}`);
}

// 시스템 테이프 키(album:… · artist:… · box:… · year-… · genre-… · collection) → 상세 화면 주소
function sysTapeHref(k) {
  const id = k.replace(/^(album|artist|box):/, "");
  return k.startsWith("album:") ? "#/album/" + encodeURIComponent(id) : k.startsWith("artist:") ? "#/artist/" + encodeURIComponent(id) : k.startsWith("box:") ? "#/box/" + encodeURIComponent(id)
    : k.startsWith("year-") ? "#/year/" + k.slice(5) : k.startsWith("genre-") ? "#/genre/" + encodeURIComponent(k.slice(6)) : "#/collection";
}
// 지금 듣는 테이프의 상세 화면 주소 (선택한 곡·검색 결과처럼 임의로 만든 테이프면 null)
function nowTapeHref() {
  const k = tapeKey(nowCtx()); if (!k) return null;
  if (tapeById(k)) return tapeHref({ id: k });
  return /^(album:|artist:|box:|year-|genre-|collection$)/.test(k) ? sysTapeHref(k) : null;
}
// 시스템 테이프(앨범·가수·시대·장르·곡 목록·상자) 메뉴: 재생하기 · 테이프 상세보기
function sysTapeMenu(k, x, y) {
  const t = sysTape(k); if (!t) return;
  if (t.temp) { openMenu(x, y, `<div class="mh"><div><b>${esc(t.pl.name)}</b><span>${U.num(t.pl.items.length)}곡 · 이번에만 있는 테이프</span></div></div><button data-m="sys-play" data-k="${esc(k)}"><i class="ic ic-play"></i>재생하기</button>`); return; }
  const href = sysTapeHref(k);
  openMenu(x, y, `<div class="mh"><div><b>${esc(t.pl.name)}</b><span>${U.num(t.pl.items.length)}곡</span></div></div>
    <button data-m="sys-play" data-k="${esc(k)}"><i class="ic ic-play"></i>재생하기</button>
    <button data-m="go" data-href="${href}"><i class="ic ic-tape"></i>테이프 상세보기</button>`);
}
// 앨범 메뉴: 재생하기 · 셔플 재생 · 대기열에 추가 · 앨범 열기 · 아티스트
function albumMenu(key, x, y) {
  const a = L.albums.get(key); if (!a) return;
  openMenu(x, y, `<div class="mh">${art(a, 100)}<div><b>${esc(a.title)}</b><span>${esc(a.artist)} · ${a.tracks.length}곡</span></div></div>
    <button data-m="album-play" data-album="${esc(key)}"><i class="ic ic-play"></i>재생하기</button>
    <button data-m="album-shuffle" data-album="${esc(key)}"><i class="ic ic-shuffle"></i>셔플 재생</button>
    <button data-m="album-queue" data-album="${esc(key)}"><i class="ic ic-plus"></i>대기열 맨 뒤에 추가</button>
    <hr>
    <button data-m="go" data-href="#/album/${encodeURIComponent(key)}"><i class="ic ic-stack"></i>앨범 열기</button>
    ${splitArtists(a.artist).map((n) => `<button data-m="go" data-href="#/artist/${encodeURIComponent(n)}"><i class="ic ic-person"></i>${esc(n)}</button>`).join("")}`);
}

const modal = $("#modal");
function openModal(html, cls) {
  modal.innerHTML = `<div class="modal-box${cls ? " " + cls : ""}">${html}</div>`; modal.hidden = false;
  const f = $("input,textarea", modal);
  if (f) setTimeout(() => { f.focus(); if (f.setSelectionRange && /^(text|search|url|tel|password|)$/.test(f.type || "")) f.setSelectionRange(f.value.length, f.value.length); }, 30); // 체크상자 등은 글자 선택이 없다
}
function closeModal() { modal.hidden = true; modal.innerHTML = ""; }
modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });

function playlistModal(p, thenAdd, intoBox) {
  // 빈 테이프를 꺼내 놓고 마스킹 테이프에 바로 제목을 적는다
  const pl = p || { id: "new", name: "", items: thenAdd || [] };
  const band = p ? bandTrack(p) : thenAdd && thenAdd.length ? L.byId.get(thenAdd[0]) : null;
  openModal(`<h3>${p ? "테이프 고치기" : "새 테이프"}</h3>
    <p class="dimmer" style="margin:-8px 0 14px;font-size:13px">마스킹 테이프에 제목을 적어 주세요</p>
    <div class="tape-edit-wrap">${cassette(pl, band, { editName: true, noHeart: true })}</div>
    <form id="pl-form"><textarea class="field" name="desc" maxlength="300" placeholder="이 테이프에 대한 메모 (선택)">${esc(p ? p.desc || "" : "")}</textarea>
    <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">${p ? "저장" : "만들기"}</button></div></form>`, "wide");
  $("#pl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const name = String(fd.get("name")).trim(); const desc = String(fd.get("desc")).trim();
    if (!name) return;
    closeModal();
    if (p) { savePlaylist(p, { name, desc }); return; }
    try {
      const np = await API.createPlaylist(name, thenAdd || []);
      np.desc = desc; if (desc) API.updatePlaylist(np.id, { desc }).catch(() => {});
      L.playlists.push(np); renderSidebar();
      const bx = intoBox && L.boxes.find((x) => x.id === intoBox);
      if (bx) { moveTapes([np.id], bx, true); toast(`「${bx.name}」 상자에 새 테이프를 넣었어요`); }
      else if (thenAdd && thenAdd.length) toast(`「${name}」에 담았어요`);
      closeFull(); location.hash = "#/playlist/" + encodeURIComponent(np.id); // 어디서 만들든 새 테이프 화면으로 바로
    } catch (err) { toast("만들지 못했어요: " + err.message); }
  });
}
// 테이프 꾸미기: 목록·선반에서 보일 대표 배경을 테이프 속 곡의 앨범아트나 색 중에서 고른다
const DECOR_COLORS = ["#6b5a45", "#8c3b2e", "#b5652b", "#c99a2e", "#5f7a3a", "#2f6b5a", "#2e5a7a", "#3b4a8c", "#6a3f80", "#8c3b62", "#3a3a3a", "#d9cdb4"];
function decorModal(p) {
  if (!p) return;
  let sel = coverOf(p) ? p.cover : "";
  const seen = new Set(), albums = []; // 같은 앨범은 한 번만 (앨범아트가 같으니)
  for (const id of p.items) { const t = L.byId.get(id); if (t && !seen.has(t.albumKey)) { seen.add(t.albumKey); albums.push(t); } }
  const custom = /^c:#/.test(sel) && !DECOR_COLORS.includes(sel.slice(2).toLowerCase()) ? sel.slice(2) : "";
  openModal(`<h3>테이프 꾸미기</h3>
    <p class="dimmer" style="margin:-8px 0 14px;font-size:13px">목록이나 선반에서 보일 테이프 배경을 골라 주세요. 듣고 있을 땐 지금 곡의 앨범아트가 보여요</p>
    <div class="tape-edit-wrap decor-preview"></div>
    <div class="decor-sec"><h4>배경색</h4><div class="decor-colors">
      <button type="button" class="decor-auto" data-cv="" title="최근 들은 곡의 앨범아트">자동</button>
      ${DECOR_COLORS.map((c) => `<button type="button" class="decor-sw" data-cv="c:${c}" style="background:${c}" title="${c}"></button>`).join("")}
      <label class="decor-sw decor-custom${custom ? "" : " empty"}" title="직접 고르기" style="${custom ? `background:${custom}` : ""}"><input type="color" value="${custom || "#6b5a45"}"><i class="ic ic-plus"></i></label>
    </div></div>
    <div class="decor-sec arts"><h4>앨범아트${albums.length ? ` <span class="dimmer">· ${albums.length}장</span>` : ""}</h4>
      ${albums.length ? `<div class="decor-arts">${albums.map((t) => `<button type="button" class="decor-art" data-cv="t:${esc(t.id)}" title="${esc(t.album || t.title)} · ${esc(t.artist)}">${art(t, 160)}<span>${esc(t.album || t.title)}</span></button>`).join("")}</div>`
        : '<p class="dimmer" style="font-size:13px">테이프에 곡을 담으면 그 곡의 앨범아트를 고를 수 있어요</p>'}</div>
    <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button type="button" class="btn primary" id="decor-ok">저장</button></div>`, "wide");
  const box = modal.firstChild, prev = $(".decor-preview", box), picker = $(".decor-custom input", box), cus = $(".decor-custom", box);
  const draw = () => {
    prev.innerHTML = cassette(Object.assign({}, p, { cover: sel }), bandTrack(p), { noHeart: true, decor: true });
    $$("[data-cv]", box).forEach((b) => b.classList.toggle("on", b.dataset.cv === sel));
    cus.classList.toggle("on", sel.startsWith("c:") && !DECOR_COLORS.includes(sel.slice(2)));
  };
  box.addEventListener("click", (e) => { const b = e.target.closest("[data-cv]"); if (!b) return; sel = b.dataset.cv; draw(); });
  picker.addEventListener("input", () => { sel = "c:" + picker.value.toLowerCase(); cus.style.background = picker.value; cus.classList.remove("empty"); draw(); });
  $("#decor-ok", box).addEventListener("click", () => {
    closeModal();
    if ((coverOf(p) ? p.cover : "") === sel) return;
    savePlaylist(p, { cover: sel }); toast(sel ? "테이프를 꾸몄어요" : "배경을 자동으로 되돌렸어요");
  });
  draw();
}
// 테이프 고르기 팝업 위 검색창: 테이프 이름이 맞는 것 먼저, 그다음 담긴 곡의 제목·가수가 맞는 것 (초성도). tail은 검색어가 없을 때만 끝에 붙인다
// group(pl): 묶음 번호 (0이 먼저). groupLabel[n]: n번 묶음 앞 구분선 글자
function pickHtml(items, cell, group, groupLabel) {
  if (!group) return items.map(cell).join("");
  const G = [];
  for (const pl of items) (G[group(pl)] = G[group(pl)] || []).push(pl);
  return G.map((arr, n) => arr && arr.length ? (n && G.slice(0, n).some((x) => x && x.length) ? `<div class="pick-divider"><span>${esc(groupLabel[n] || "")}</span></div>` : "") + arr.map(cell).join("") : "").join("");
}
function bindPickSearch(input, grid, list, cell, tail, group, groupLabel) {
  const draw = () => {
    const raw = input.value.trim(), q = U.norm(raw), cho = U.isChoQuery(raw);
    if (!q) { grid.innerHTML = pickHtml(list, cell, group, groupLabel) + (tail || ""); return; }
    const byName = [], bySong = [];
    list.forEach((pl) => {
      const n = U.norm(pl.name);
      if (cho ? U.chosung(n).includes(q) : n.includes(q)) byName.push(pl);
      else if (pl.items.some((id) => { const t = L.byId.get(id); return t && (cho ? t._cho.includes(q) : t._q.includes(q)); })) bySong.push(pl);
    });
    const found = byName.concat(bySong);
    grid.innerHTML = found.length ? pickHtml(found, cell, group, groupLabel) : '<p class="dimmer pick-empty">찾는 테이프가 없어요</p>';
  };
  input.addEventListener("input", draw);
  return draw;
}
// 곡을 테이프에 담기 (곡 메뉴·여러 곡 선택): 상자의 「테이프 추가하기」와 같은 화면. 누르면 바로 담긴다
function addToPlaylistModal(ids) {
  const one = ids.length === 1;
  const T = sortedTapes().filter((p) => !isSysTape(p.id)); // 최근에 들은 순 (시스템·히스토리 테이프는 저절로 채워져 담을 수 없다)
  const cell = (p) => `<div class="pick-tape" role="button" tabindex="0" data-pl="${esc(p.id)}" title="「${esc(p.name)}」에 담기">${cassette(p, bandTrack(p), { noHeart: true })}${one && p.items.includes(ids[0]) ? '<span class="already">담겨 있음</span>' : ""}</div>`;
  const tail = `<button class="tape-new" data-pl="__new"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button>`;
  openModal(`<h3>테이프에 담기</h3><p class="dimmer" style="margin:-8px 0 12px;font-size:13px">${one ? "" : `${ids.length}곡을 `}담을 테이프를 눌러 주세요</p>
    <label class="search-box pick-search"><i class="ic ic-search"></i><input type="search" placeholder="테이프 이름이나 곡으로 찾기" autocomplete="off" spellcheck="false"></label>
    <div class="pick-tapes">${T.map(cell).join("")}${tail}</div>
    <div class="row-btns"><button class="btn ghost" data-close>닫기</button></div>`, "wide");
  const grid = $(".pick-tapes", modal);
  bindPickSearch($(".pick-search input", modal), grid, T, cell, tail);
  grid.addEventListener("keydown", (e) => { const b = e.target.closest(".pick-tape"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); b.click(); } });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pl]"); if (!b) return;
    if (b.dataset.pl === "__new") { playlistModal(null, ids); return; }
    const p = L.playlists.find((x) => x.id === b.dataset.pl);
    const add = ids.filter((i) => !p.items.includes(i));
    closeModal();
    if (!add.length) { toast("이미 담겨 있어요"); return; }
    savePlaylist(p, { items: p.items.concat(add) });
    toast(`「${p.name}」에 담았어요`);
  });
}
// 설정 → 기록 초기화: 고른 것만 지운다. 되돌릴 수 없으니 한 번 더 묻는다
function resetRecordsModal() {
  const opt = (k, title, desc) => `<label class="reset-opt"><input type="checkbox" name="${k}"><span><b>${title}</b><small>${desc}</small></span></label>`;
  openModal(`<h3>어떤 기록을 지울까요?</h3><form id="reset-form">
    ${opt("plays", "들은 횟수", "곡마다 들은 횟수와 함께한 시간")}
    ${opt("favs", "아끼는 곡 표시", "하트를 누른 곡이 모두 풀려요 (곡은 그대로)")}
    ${opt("history", "최근 들은 기록", "처음·마지막으로 들은 날, 최근 들은 테이프")}
    <p class="dimmer" style="font-size:12.5px;margin:12px 0 0">지운 기록은 되돌릴 수 없어요.</p>
    <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" id="reset-ok" disabled style="background:#e06464;color:#fff">초기화하기</button></div></form>`);
  const form = $("#reset-form"), ok = $("#reset-ok");
  form.addEventListener("change", () => { ok.disabled = !$$("input:checked", form).length; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const what = { plays: form.plays.checked, favs: form.favs.checked, history: form.history.checked };
    if (!what.plays && !what.favs && !what.history) return;
    closeModal();
    API.resetRecords(what).then(() => {
      if (what.history) { Prefs.set({ tapePlayed: null }); for (const k in tempPlayed) delete tempPlayed[k]; }
      toast("기록을 초기화했어요");
      return reloadLibrary().then(() => renderSidebar());
    }).catch((err) => toast("초기화하지 못했어요: " + err.message));
  });
}
function deletePlaylist(p) {
  if (!p) return;
  openModal(`<h3>테이프를 삭제할까요?</h3><p class="dim" style="margin:0">「${esc(p.name)}」을(를) 삭제해요. 곡 자체는 컬렉션에 그대로 남아요.</p>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="pl-del-ok" style="background:#e06464;color:#fff">삭제하기</button></div>`);
  $("#pl-del-ok").addEventListener("click", () => {
    closeModal();
    L.playlists = L.playlists.filter((x) => x !== p); renderSidebar();
    if (boxOf(p.id)) moveTapes([p.id], null, true);
    API.deletePlaylist(p.id).catch((e) => toast("삭제하지 못했어요: " + e.message));
    location.hash = "#/";
  });
}

// ── 상자 고치기 ──
function saveBox(b, patch, quiet) {
  if (b.system) return Promise.resolve(); // 시스템 상자는 고칠 수 없다
  Object.assign(b, patch, { updated: Date.now() });
  if (!quiet) rerender();
  return API.updateBox(b.id, patch).catch((e) => toast("저장하지 못했어요: " + e.message));
}
// 테이프들을 target 상자로 옮긴다 (null이면 상자에서 꺼내기). 다른 상자에 있던 건 거기서 빠진다
function moveTapes(ids, target, quiet) {
  ids = ids.filter(canBox); // 시스템·히스토리·임의 테이프는 내 상자에 넣을 수 없다
  if (target && !canBoxInto(target.id)) return;
  for (const b of L.boxes) {
    if (b === target) continue;
    const items = b.items.filter((id) => !ids.includes(id));
    if (items.length !== b.items.length) saveBox(b, { items }, true);
  }
  if (target) { const add = ids.filter((id) => !target.items.includes(id)); if (add.length) saveBox(target, { items: target.items.concat(add) }, true); }
  if (!quiet) rerender();
}
function boxModal(b, thenPut) {
  openModal(`<h3>${b ? "상자 이름 고치기" : "새 상자"}</h3>
    <p class="dimmer" style="margin:-8px 0 14px;font-size:13px">상자 앞에 붙일 이름을 적어 주세요</p>
    <form id="box-form"><input class="field" name="name" maxlength="40" value="${esc(b ? b.name : "")}" placeholder="예: 여름에 듣는 테이프" autocomplete="off" spellcheck="false" required>
    <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">${b ? "저장" : "만들기"}</button></div></form>`);
  $("#box-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target).get("name")).trim(); if (!name) return;
    closeModal();
    if (b) { saveBox(b, { name }); return; }
    try {
      const nb = await API.createBox(name, []);
      L.boxes.push(nb);
      if (thenPut && thenPut.length) { moveTapes(thenPut, nb); const pl = tapeById(thenPut[0]); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${name}」 상자에 넣었어요`); }
      else location.hash = boxHref(nb);
    } catch (err) { toast("만들지 못했어요: " + err.message); }
  });
}
// 테이프 하나를 넣을 상자 고르기
function pickBoxModal(plId) {
  const pl = tapeById(plId); if (!pl) return;
  const cur = boxOf(plId);
  openModal(`<h3>「${esc(pl.name)}」을(를) 어느 상자에?</h3><div class="pick-tapes">
    ${L.boxes.map((b) => `<div class="pick-tape" role="button" tabindex="0" data-bx="${esc(b.id)}" title="「${esc(b.name)}」에 넣기">${tbox(b)}${b === cur ? '<span class="already">들어 있음</span>' : ""}</div>`).join("")}
    <button class="tape-new" data-bx="__new"><i class="ic ic-box"></i><span>새 상자 만들어 넣기</span></button>
  </div><div class="row-btns"><button class="btn ghost" data-close>닫기</button></div>`, "wide");
  const grid = $(".pick-tapes", modal);
  grid.addEventListener("keydown", (e) => { const t = e.target.closest(".pick-tape"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); t.click(); } });
  grid.addEventListener("click", (e) => {
    const t = e.target.closest("[data-bx]"); if (!t) return;
    if (t.dataset.bx === "__new") { boxModal(null, [plId]); return; }
    const b = L.boxes.find((x) => x.id === t.dataset.bx);
    closeModal();
    if (b === cur) { toast("이미 들어 있어요"); return; }
    moveTapes([plId], b);
    toast(`「${pl.name}」을(를) 「${b.name}」 상자에 넣었어요`);
  });
}
// 재생목록 편집 → 「곡 추가하기」: 검색해서 하나씩 담는다 (담은 곡은 목록 맨 뒤에)
function addTracksModal(p) {
  openModal(`<h3>「${esc(p.name)}」에 곡 추가</h3>
    <div class="search-box"><i class="ic ic-search"></i><input type="search" id="add-q" placeholder="제목·아티스트·앨범, 초성으로도" autocomplete="off"></div>
    <div class="add-finder" id="add-res"><p class="dimmer">찾을 곡을 입력해 주세요</p></div>
    <div class="row-btns"><button class="btn primary" data-close>완료</button></div>`, "wide add-modal");
  const inp = $("#add-q", modal), res = $("#add-res", modal);
  const draw = () => {
    const r = search(inp.value);
    if (!r) { res.innerHTML = '<p class="dimmer">찾을 곡을 입력해 주세요</p>'; return; }
    res.innerHTML = r.tracks.length ? `<div class="tracklist">${r.tracks.slice(0, 40).map((t) => `<div class="row" data-id="${esc(t.id)}"><div class="t">${art(t, 120)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div><span class="alb">${esc(t.album)}</span>${p.items.includes(t.id) ? '<span class="added"><i class="ic ic-check"></i>담음</span>' : `<button class="btn" data-act="pl-add" data-id="${esc(t.id)}">담기</button>`}</div>`).join("")}</div>` : '<p class="dimmer">찾는 곡이 없어요</p>';
  };
  inp.addEventListener("input", U.debounce(draw, 150));
}
// 상자 편집 → 「테이프 추가하기」: 이 상자에 없는 테이프를 골라 넣는다. 다른 상자의 테이프는 이 상자로 옮겨 온다
function addTapesModal(b) {
  const pick = new Set();
  const T = sortedTapes().filter((pl) => !b.items.includes(pl.id) && !isSysTape(pl.id)); // 이 상자에 이미 든 테이프·시스템 테이프는 보이지 않는다
  const inOther = (pl) => (boxOf(pl.id) ? 1 : 0), LABEL = ["", "다른 상자에 든 테이프"]; // 상자 밖 먼저, 다른 상자에 든 건 구분선 뒤에
  if (!T.length) { toast("더 넣을 테이프가 없어요"); return; }
  const badge = (pl) => { if (pick.has(pl.id)) return '<span class="already">고름</span>'; const o = boxOf(pl.id); return o ? `<span class="already other">${esc(o.name)}</span>` : ""; };
  const cell = (pl) => `<div class="pick-tape${pick.has(pl.id) ? " on" : ""}" role="button" tabindex="0" data-pl="${esc(pl.id)}">${cassette(pl, bandTrack(pl), { noHeart: true })}${badge(pl)}</div>`;
  openModal(`<h3>「${esc(b.name)}」에 넣을 테이프</h3><p class="dimmer" style="margin:-8px 0 12px;font-size:13px">눌러서 고르고 「넣기」. 다른 상자의 테이프를 고르면 이 상자로 옮겨 와요</p>
    <label class="search-box pick-search"><i class="ic ic-search"></i><input type="search" placeholder="테이프 이름이나 곡으로 찾기" autocomplete="off" spellcheck="false"></label>
    <div class="pick-tapes">${pickHtml(T, cell, inOther, LABEL)}</div>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="box-add-ok">넣기</button></div>`, "wide");
  const grid = $(".pick-tapes", modal);
  bindPickSearch($(".pick-search input", modal), grid, T, cell, "", inOther, LABEL); // 찾는 동안에도 고른 것은 그대로 남는다
  grid.addEventListener("keydown", (e) => { const t = e.target.closest(".pick-tape"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); t.click(); } });
  grid.addEventListener("click", (e) => {
    const t = e.target.closest(".pick-tape[data-pl]"); if (!t) return;
    const id = t.dataset.pl; pick.has(id) ? pick.delete(id) : pick.add(id);
    t.outerHTML = cell(tapeById(id));
    const nt = $(`.pick-tape[data-pl="${CSS.escape(id)}"]`, grid); if (nt) nt.focus({ preventScroll: true });
  });
  $("#box-add-ok").addEventListener("click", () => {
    closeModal();
    const add = T.map((pl) => pl.id).filter((id) => pick.has(id));
    if (add.length) { moveTapes(add, b); toast(`테이프 ${add.length}개를 넣었어요`); }
  });
}
function deleteBox(b) {
  if (!b) return;
  openModal(`<h3>상자를 삭제할까요?</h3><p class="dim" style="margin:0">「${esc(b.name)}」 상자만 삭제해요. 안에 있던 테이프 ${b.items.length}개는 나의 테이프에 그대로 남아요.</p>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="box-del-ok" style="background:#e06464;color:#fff">삭제하기</button></div>`);
  $("#box-del-ok").addEventListener("click", () => {
    closeModal();
    L.boxes = L.boxes.filter((x) => x !== b);
    API.deleteBox(b.id).catch((e) => toast("삭제하지 못했어요: " + e.message));
    location.hash = "#/playlists";
  });
}

let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200); }

function toggleFav(id) {
  const t = L.byId.get(id); if (!t) return;
  t.fav = !t.fav; t.favAt = t.fav ? Date.now() : 0;
  API.setTrack(id, { fav: t.fav }).catch(() => { t.fav = !t.fav; toast("저장하지 못했어요"); refreshAfterChange(id); });
  toast(t.fav ? "아끼는 곡에 담았어요" : "아끼는 곡에서 뺐어요");
  refreshAfterChange(id);
}
function refreshAfterChange(id) {
  renderSidebar(); renderBar(); renderFull();
  if (["liked", "home", "playlists", "library", "box"].includes(route().name)) return rerender();
  const t = L.byId.get(id); if (!t) return;
  $$('[data-act="fav"]').forEach((b) => {
    const bid = b.dataset.id || (b.closest("[data-id]") && b.closest("[data-id]").dataset.id);
    if (bid !== id) return;
    b.classList.toggle("on", !!t.fav);
    if (!b.classList.contains("tape-heart")) b.innerHTML = `<i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i>`;
  });
}
