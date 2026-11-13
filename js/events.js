// 입력 처리: 클릭 위임, 테이프 끌어다 상자에 넣기, 여러 곡 선택, 재생 상태 반영
"use strict";

// ───────── 클릭 처리 (위임) ─────────
document.addEventListener("click", (e) => {
  if (U.clickSuppressed()) { e.preventDefault(); e.stopPropagation(); return; }
  // 여러 곡 선택: 선택 중에는 곡 줄·카드를 누르면 고르기만 한다. PC는 Ctrl/Shift+클릭으로 바로 시작
  const pickEl = e.target.closest("#view .row[data-id], #view .card[data-id]");
  if (pickEl && !pickEl.closest(".add-finder") && !e.target.closest('[data-act="fav"], [data-handle]') && (SEL.on || e.target.closest(".row .ck:not(.off)") || (!isMobile() && (e.ctrlKey || e.metaKey || e.shiftKey)))) {
    e.preventDefault(); e.stopPropagation();
    if (!SEL.on) { SEL.on = true; $$(".row.sel").forEach((r) => r.classList.remove("sel")); }
    selPick(pickEl, e.shiftKey);
    return;
  }
  const a = e.target.closest("[data-act]");
  const rowEl = e.target.closest(".row[data-id]");
  // 재생 화면 볼륨: 바깥을 누르면 접는다
  // 폰 재생 막대: 오른쪽 버튼들 말고는 어디를 눌러도 재생 화면으로
  if (isMobile() && e.target.closest("#playerbar") && !e.target.closest(".pb-mini")) { e.preventDefault(); openFull(); return; }
  if (e.target.closest("[data-stop]")) {
    if (isMobile() && e.target.closest("#playerbar")) { e.preventDefault(); openFull(); return; }
    if (!fp.hidden) closeFull();
    return; // 링크는 그대로
  }
  if (a) {
    const act = a.dataset.act;
    const id = a.dataset.id || (a.closest("[data-id]") && a.closest("[data-id]").dataset.id);
    switch (act) {
      case "back": goBack(); return;
      case "toggle":
        if (a.closest(".np-tape-wrap") && isMobile()) { setMemo(true); return; } // 폰: 카세트를 누르면 가사 메모지 (PC는 옆 패널의 가사 탭)
        P.toggle(); return;
      case "insert-tape": insertTape(a.dataset.pl); return;
      case "reset-records": resetRecordsModal(); return;
      case "home-now": if (!P.current) { npEjected = true; lastTapeId = lastBoxId = null; } openFull(); return; // 비어 있으면 꽂을 테이프 고르기
      case "side-box": sideBox = a.dataset.bx; renderSidebar(); $("#side-playlists").scrollTop = 0; return;
      case "side-out": sideBox = null; renderSidebar(); return;
      case "shelf-box": shelfBox = shelfBox === a.dataset.bx ? null : a.dataset.bx; if (shelfDraw) shelfDraw(); return; // 같은 상자를 다시 누르면 나오기, 다른 상자는 바로 그 상자로
      case "memo-close": if (!e.target.closest(".ln[data-ms]")) setMemo(false); return;
      case "memo-theme": {
        memoTheme = memoTheme === "paper" ? "plain" : "paper";
        try { localStorage.setItem("mc.lyrTheme", memoTheme); } catch (err) {}
        const m = a.closest(".np-memo"); m.classList.remove("paper", "plain"); m.classList.add(memoTheme);
        a.outerHTML = memoThemeBtn();
        syncLyrics(true); return;
      }
      case "next": P.next(); return;
      case "prev": P.prev(); return;
      case "shuffle": toast(P.toggleShuffle() ? "셔플을 켰어요" : "셔플을 껐어요"); return;
      case "repeat": { const m = P.cycleRepeat(); toast({ off: "반복을 껐어요", all: "전체 반복", one: "한 곡 반복" }[m]); renderBar(); renderFull(); return; }
      case "fav": e.preventDefault(); toggleFav(id); return;
      case "more": { e.preventDefault(); e.stopPropagation(); const r = a.getBoundingClientRect(); const lst = a.closest("[data-list]"); trackMenu(id, r.left - 200, r.bottom + 4, { list: lst ? lst.dataset.list : "", i: rowEl ? +rowEl.dataset.i : -1, sel: !!(rowEl && rowEl.closest("#view") && !rowEl.closest(".add-finder")) }); return; }
      case "open-full": openFull(); return;
      case "mini-queue": // 재생 화면을 열고 재생목록을 아래에서 끌어올린다 (폰)
        npSide = "queue"; if (fp.hidden) openFull(); else renderNpSide();
        if (isMobile()) fp.classList.add("q-open");
        return;
      case "q-close": fp.classList.remove("q-open"); return;
      case "close-full": closeFull(); return;
      case "np-side": npSide = a.dataset.v; renderNpSide(); return;
      case "panel": { const v = a.dataset.v; if (panelOpen && panelTab === v) panelOpen = false; else { panelOpen = true; panelTab = v; } try { localStorage.setItem("mc.panel", panelOpen ? "1" : "0"); } catch (err) {} renderPanel(); renderBar(); return; }
      case "close-panel": panelOpen = false; try { localStorage.setItem("mc.panel", "0"); } catch (err) {} renderPanel(); renderBar(); return;
      case "q-remove": { e.stopPropagation(); P.removeAt(+a.closest("[data-q]").dataset.q); return; }
      case "list-play": case "list-shuffle": {
        const name = a.dataset.list; const ids = lists[name] || [];
        if (!ids.length) { toast(name === "box" ? "빈 상자예요" : "곡이 없어요"); return; }
        P.playList(ids, 0, ctxFor(name), { shuffle: act === "list-shuffle", randomStart: act === "list-shuffle" });
        return;
      }
      case "track-play": e.preventDefault(); e.stopPropagation(); playTrackHere(id); return;
      case "card-play": {
        e.preventDefault(); e.stopPropagation();
        const lst = a.closest("[data-list]"), ids = lst && lists[lst.dataset.list];
        if (ids) P.playList(ids, ids.indexOf(id), ctxFor(lst.dataset.list), { shuffle: false });
        else playTrackHere(id, a.closest(".shelf"));
        return;
      }
      case "album-play": { e.preventDefault(); e.stopPropagation(); const al = L.albums.get(a.closest("[data-album]").dataset.album); P.playList(al.tracks.map((t) => t.id), 0, { type: "album", id: al.key, name: al.title }); return; }
      case "col-filter": colState.filter = a.dataset.v; saveCol(); if (route().arg) location.hash = "#/collection"; else rerender(); return;
      case "new-playlist": playlistModal(null, null, a.dataset.into); return;
      case "pl-tape-play": { e.preventDefault(); const name = a.dataset.list; const ctx = ctxFor(name); const pl = name === "liked" ? likedPl() : tapeById(route().arg); if (P.current && nowCtx() && nowCtx().id === ctx.id) P.toggle(); else if (pl && pl.items.length) P.playList(pl.items, 0, ctx); return; }
      case "pl-edit": plEdit = !plEdit; if (SEL.on) selEnd(); rerender(); return;
      case "sel-start": selStart(null, a.dataset.list); return;
      case "sel-head": selHead(a); return;
      case "sel-cancel": selEnd(); return;
      case "sel-all": selAll(); return;
      case "sel-play": case "sel-shuffle": {
        const ids = SEL.ids.slice(); if (!ids.length) { toast("곡을 골라 주세요"); return; }
        selEnd();
        P.playList(ids, 0, { type: "collection", name: "선택한 곡" }, { shuffle: act === "sel-shuffle", randomStart: act === "sel-shuffle" });
        return;
      }
      case "sel-next": { const ids = SEL.ids.slice(); if (!ids.length) return; selEnd(); P.playNext(ids); toast(`${ids.length}곡을 다음에 재생해요`); return; }
      case "sel-addpl": { const ids = SEL.ids.slice(); if (!ids.length) return; selEnd(); addToPlaylistModal(ids); return; }
      case "pl-more": { const r = a.getBoundingClientRect(); const p = curPlaylist(), bx = p && boxOf(p.id); openMenu(r.right - 240, r.bottom + 6, `<button data-m="pl-rename"><i class="ic ic-pen"></i>이름·설명 고치기</button><button data-m="pl-queue"><i class="ic ic-queue"></i>대기열에 추가</button>${p ? `<button data-m="tape-box" data-pl="${esc(p.id)}"><i class="ic ic-box"></i>${bx ? "다른 상자로 옮기기…" : "상자에 넣기…"}</button>` : ""}${bx ? `<button data-m="tape-unbox" data-pl="${esc(p.id)}"><i class="ic ic-x"></i>상자에서 꺼내기</button>` : ""}<hr><button data-m="pl-delete" class="danger"><i class="ic ic-trash"></i>테이프 삭제하기</button>`); return; }
      case "box-more": { const r = a.getBoundingClientRect(); const cb = curBox();
        if (cb && cb.system) { openMenu(r.right - 240, r.bottom + 6, `<button data-m="box-queue"><i class="ic ic-queue"></i>대기열에 추가</button><hr><button data-m="box-hide" data-bx="${esc(cb.id)}"><i class="ic ic-x"></i>상자 숨기기</button>`); return; }
        openMenu(r.right - 240, r.bottom + 6, `<button data-m="box-rename"><i class="ic ic-pen"></i>상자 이름 고치기</button><button data-m="box-queue"><i class="ic ic-queue"></i>대기열에 추가</button><hr><button data-m="box-delete" class="danger"><i class="ic ic-trash"></i>상자 삭제하기</button>`); return; }
      case "box-edit": boxEdit = !boxEdit; rerender(); return;
      case "box-remove": { e.stopPropagation(); const bx = curBox(), pl = tapeById(a.dataset.pl); if (bx) { saveBox(bx, { items: bx.items.filter((x) => x !== a.dataset.pl) }); if (pl) toast(`「${pl.name}」을(를) 상자에서 뺐어요`); } return; }
      case "box-add-open": { const bx = curBox(); if (bx) addTapesModal(bx); return; }
      case "pl-add-open": { const p = curPlaylist(); if (p) addTracksModal(p); return; }
      case "new-box": boxModal(null); return;
      case "pl-remove": { const p = curPlaylist(); if (p && rowEl) { const items = p.items.slice(); items.splice(+rowEl.dataset.i, 1); savePlaylist(p, { items }); } return; }
      case "pl-add": {
        const p = curPlaylist(); if (!p) return;
        if (!p.items.includes(id)) savePlaylist(p, { items: p.items.concat([id]) });
        a.outerHTML = '<span class="added"><i class="ic ic-check"></i>담음</span>';
        return;
      }
      case "pldir-pick": try { window.NativeBridge.pickPlaylistDir(); } catch (err) {} return;
      case "export-pick": try { window.NativeBridge.pickExportDir(); } catch (err) {} return;
      case "export-now": try { window.NativeBridge.exportNow(); } catch (err) {} toast("테이프를 파일로 저장하고 있어요"); return;
      case "export-clear": try { window.NativeBridge.clearExportDir(); } catch (err) {} toast("저장 폴더를 해제했어요. 이미 만든 파일은 그대로 있어요"); rerender(); return;
      case "box-show": { const on = !a.classList.contains("on"); setBoxHidden(a.dataset.bx, !on); renderSidebar(); rerender(); toast(on ? "다시 보이게 했어요" : "숨겼어요"); return; }
      case "export-hist": { const on = !a.classList.contains("on"); try { window.NativeBridge.setExportHist(on); } catch (err) {} toast(on ? "히스토리 상자도 저장해요" : "히스토리 상자는 이제 저장하지 않아요. 이미 만든 파일은 그대로 있어요"); rerender(); return; }
      case "export-auto": { const on = !a.classList.contains("on"); try { window.NativeBridge.setExportAuto(on); } catch (err) {} toast(on ? "자동 저장을 켰어요. 그동안 바뀐 것도 맞춰 둘게요" : "자동 저장을 껐어요. 「지금 저장」을 누를 때만 저장해요"); rerender(); return; }
      case "pldir-clear": try { window.NativeBridge.clearPlaylistDir(); } catch (err) {} toast("가져오기 폴더를 해제했어요. 이미 가져온 테이프는 남아 있어요"); rerender(); return;
      case "fd-open": { const p = a.dataset.path; FD.open.has(p) ? FD.open.delete(p) : FD.open.add(p); renderFolderCard(); return; }
      case "fd-check": { const ps = fdUnder(a.dataset.path), turnOff = ps.some((p) => !FD.off.has(p)); ps.forEach((p) => (turnOff ? FD.off.add(p) : FD.off.delete(p))); FD.dirty = true; renderFolderCard(); return; }
      case "fd-auto": FD.autoNew = !FD.autoNew; FD.dirty = true; renderFolderCard(); return;
      case "fd-apply": {
        if (!FD || FD.saving) return;
        FD.saving = true; renderFolderCard();
        API.setFolders([...FD.off], FD.autoNew).then(() => { FD = null; toast("라이브러리 폴더를 바꿨어요"); return reloadLibrary(); })
          .catch((err) => { if (FD) { FD.saving = false; renderFolderCard(); } toast("실패: " + err.message); });
        return;
      }
      case "plfile-add": plFileAdd(); return;
      case "ls-pick": case "ls-install": case "ls-stop": case "ls-remove": case "ls-start": case "ls-tab": case "ls-revert": case "ls-keep": case "ls-retry": case "ls-revert-all": case "ls-reset": case "ls-source": case "ls-pick-music": case "ls-send": lsAct(act, a); return;
      case "lyr-retry": $$("[data-lyr]").forEach((b) => mountLyrics(b)); return;
      case "lyr-revert": revertLyricsModal(a.dataset.id); return;
      case "server-toggle": { const on = !a.classList.contains("on"); try { window.NativeBridge.setServerEnabled(on); } catch (err) {} setTimeout(rerender, 400); return; }
      case "dev-import": {
        openModal(`<h3>원래 앱 데이터로 덮어쓸까요?</h3><p class="dim" style="margin:0">디버그 앱의 기록·테이프·상자를 원래 앱 것으로 바꿔요.</p>
          <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="dev-import-ok">가져오기</button></div>`);
        $("#dev-import-ok").addEventListener("click", () => {
          closeModal(); toast("원래 앱에서 가져오는 중…");
          API.devImport().then((r) => { toast(`${U.num(r.tracks)}곡의 기록과 테이프 ${r.playlists}개${r.boxes >= 0 ? `, 상자 ${r.boxes}개` : ""}를 가져왔어요`); setTimeout(reloadLibrary, 600); })
            .catch((err) => toast("실패: " + err.message));
        });
        return;
      }
      case "rescan": { toast("라이브러리를 다시 읽는 중…"); (window.NativeBridge ? Promise.resolve(window.NativeBridge.rescan()) : API.rescan()).then(() => setTimeout(reloadLibrary, 300)).catch((err) => toast("실패: " + err.message)); return; }
    }
  }
  // 대기열 줄을 누르면 그 곡으로
  const qr = e.target.closest(".q-row[data-q]");
  if (qr) { P.jump(+qr.dataset.q); return; }
  // 카드
  const card = e.target.closest('.card[data-card="track"]');
  if (card && isMobile()) { /* 폰에서는 카드도 링크로 동작 */ return; }
  // 홈(대시보드)의 테이프 줄: 누르면 바로 재생 (꾹 누르면 상세 — 아래 onContext)
  const sysEl = e.target.closest(".tape-row [data-sys], .recent-grid [data-sys]");
  if (sysEl) { playSysTape(sysEl.dataset.sys); return; }
  const rowTape = e.target.closest(".tape-row .tape[data-pl], .recent-grid .tape[data-pl]");
  if (rowTape) { playTape(rowTape.dataset.pl); return; }
  // 상자는 그 상자 안으로
  const bxEl = e.target.closest(".tbox[data-box]");
  if (bxEl) { location.hash = "#/box/" + encodeURIComponent(bxEl.dataset.box); return; }
  // 테이프는 그 재생목록으로 (LP 앨범은 링크)
  const tp = e.target.closest(".tape[data-pl]");
  if (tp && tp.closest(".tape-grid.editing")) return;
  if (tp) { const id = tp.dataset.pl; if (tempTape(id)) { playSysTape(id); return; } location.hash = tapeHref({ id }); return; }
  // 곡 줄: 폰은 한 번 누르면 재생, PC는 선택(두 번 누르면 재생)
  if (rowEl) {
    if (e.target.closest(".t-art .play")) { playRow(rowEl); return; }
    if (rowEl.closest(".add-finder")) return;
    if (isMobile()) { playRow(rowEl); return; }
    $$(".row.sel").forEach((r) => r.classList.remove("sel")); rowEl.classList.add("sel");
  }
});
document.addEventListener("dblclick", (e) => {
  if (SEL.on) return;
  const rowEl = e.target.closest(".row[data-id]");
  if (rowEl && !e.target.closest("button,a") && !rowEl.closest(".add-finder")) playRow(rowEl);
});
document.addEventListener("change", (e) => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  if (a.dataset.act === "col-sort") { colState.sort = a.value; saveCol(); rerender(); }
  if (a.dataset.act === "lib-sort") { libSort[a.dataset.k] = a.value; saveLibSort(); rerender(); }
});
const saveMemo = U.debounce((id, val) => {
  API.setTrack(id, { memo: val }).then(() => { const s = $("#memo-state"); if (s) s.textContent = "저장됨"; }).catch(() => { const s = $("#memo-state"); if (s) s.textContent = "저장하지 못했어요"; });
}, 700);
document.addEventListener("input", (e) => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  if (a.dataset.act === "memo") { const t = L.byId.get(a.dataset.id); t.memo = a.value; const s = $("#memo-state"); if (s) s.textContent = "저장 중…"; saveMemo(t.id, a.value); }
  if (a.dataset.act === "list-q") { listQ[a.dataset.k] = a.value; refillList(a.dataset.k); }
});

const saveCol = () => Prefs.set({ col: Object.assign({}, colState) });
function ctxFor(name) {
  const r = route();
  if (name === "album") { const a = L.albums.get(r.arg); return { type: "album", id: r.arg, name: a && a.title }; }
  if (name.startsWith("artist")) return { type: "artist", id: r.arg, name: r.arg };
  if (name === "playlist") { const p = tapeById(r.arg); return { type: "playlist", id: r.arg, name: p && p.name }; }
  if (name === "liked") return { type: "playlist", id: "liked", name: "아끼는 곡" };
  if (name === "box") { const b = curBox(); return b ? boxCtx(b) : { type: "box", id: r.arg }; }
  if (name === "collection") return { type: "collection", id: "collection", name: "곡 목록" };
  if (name === "year") return { type: "collection", id: "year-" + parseInt(r.arg, 10), name: r.arg + "년대" };
  if (name === "genre") return { type: "collection", id: "genre-" + r.arg, name: r.arg };
  return { type: "collection", name: "" };
}
function playRow(rowEl) {
  const box = rowEl.closest("[data-list]"); const name = box && box.dataset.list;
  const id = rowEl.dataset.id;
  if (P.currentId === id && name && P.context && JSON.stringify(P.context) === JSON.stringify(ctxFor(name))) { P.toggle(); return; }
  const ids = name ? lists[name] : [id];
  P.playList(ids, ids.indexOf(id), ctxFor(name || ""), { shuffle: false });
}
function playTrackHere(id, shelf) {
  if (shelf) { const ids = $$('.card[data-id]', shelf).map((c) => c.dataset.id); P.playList(ids, ids.indexOf(id), { type: "collection", name: "" }, { shuffle: false }); }
  else P.playList([id], 0, { type: "collection", name: "" }, { shuffle: false });
}

// 테이프 재생: 이미 그 테이프를 재생 중이면 처음부터 다시 틀지 않고 재생 화면만 연다
function playTape(plId) {
  if (tempTape(plId)) { playSysTape(plId); return; } // 임의 테이프
  const pl = tapeById(plId);
  if (!pl) return;
  if (isPlayingPl(pl) && P.current) { if (!P.playing) P.play(); openFull(); return; }
  const ids = pl.items.filter((id) => L.byId.has(id));
  if (!ids.length) { toast("빈 테이프예요"); return; }
  P.playList(ids, 0, { type: "playlist", id: pl.id, name: pl.name });
}
// 테이프는 어느 화면에서든 같은 메뉴 (재생 화면의 선반·팝업 안 테이프는 제외: 거기선 누르기가 꽂기·고르기)
U.onContext(document, ".tape[data-pl], .tape[data-plid]", (el, x, y) => {
  if (TD || el.closest("#fullplayer, #modal")) return;
  const id = el.dataset.pl || el.dataset.plid; if (tempTape(id)) sysTapeMenu(id, x, y); else if (tapeById(id)) tapeMenu(id, x, y);
});
U.onContext(document, "#view [data-sys]", (el, x, y) => sysTapeMenu(el.dataset.sys, x, y));
U.onContext(document, ".lp[data-album], .card[data-album]", (el, x, y) => { if (!el.closest("#fullplayer, #modal")) albumMenu(el.dataset.album, x, y); });

// ── 테이프를 끌어다 상자에 넣기 (상자가 보이는 화면에서만) ──
// PC 마우스: 누른 채 조금 움직이면 바로 집힌다. 폰: 꾹 누르면 테이프가 들리고, 그대로 끌면 옮기고 그냥 떼면 메뉴
let TD = null;
// 상자 화면에서는 위쪽 상자 그림(data-unbox)이 「상자 밖으로」 놓는 자리가 된다 (편집 중엔 순서 바꾸기 손잡이를 쓰므로 제외)
const DROP = ".tbox[data-box], [data-unbox]";
const dragSrc = (t) => { const el = t && t.closest && t.closest(".tape-grid .tape[data-pl]"); return el && view.contains(el) && !el.closest(".editing") && canBox(el.dataset.pl) && $(DROP, view) ? el : null; };
function tdLift(x, y) {
  const el = TD.el, r = el.getBoundingClientRect();
  const k = Math.min(1, 200 / r.width); // 손에 든 테이프는 작게
  const g = el.cloneNode(true);
  g.removeAttribute("data-pl"); g.removeAttribute("data-plid"); g.classList.remove("now", "lifted"); g.classList.add("tape-ghost");
  g.style.width = r.width * k + "px";
  document.body.appendChild(g);
  Object.assign(TD, { on: true, g, ox: (x - r.left) * k, oy: (y - r.top) * k });
  el.classList.remove("lifted"); el.classList.add("drag-src"); document.body.classList.add("tape-dragging");
  tdMove(x, y); tdAuto();
}
function tdMove(x, y) {
  TD.x = x; TD.y = y;
  TD.g.style.transform = `translate(${x - TD.ox}px, ${y - TD.oy}px) rotate(-3deg)`;
  const hit = document.elementFromPoint(x, y); let bx = hit && hit.closest(DROP);
  if (bx && bx.dataset.box && !canBoxInto(bx.dataset.box)) bx = null; // 시스템·히스토리 상자에는 넣을 수 없다
  if (bx !== TD.over) { if (TD.over) TD.over.classList.remove("drop-over"); TD.over = bx; if (bx) bx.classList.add("drop-over"); }
}
// 위·아래 끝으로 끌고 가면 화면이 따라 움직인다 (상자 줄이 위로 지나가 있어도 닿게)
function tdAuto() {
  if (!TD || !TD.on) return;
  const r = view.getBoundingClientRect(), edge = 70;
  const v = TD.y < r.top + edge ? -(r.top + edge - TD.y) : TD.y > r.bottom - edge ? TD.y - (r.bottom - edge) : 0;
  if (v) { view.scrollTop += v * 0.35; tdMove(TD.x, TD.y); }
  TD.raf = requestAnimationFrame(tdAuto);
}
function tdEnd(drop) {
  const d = TD; TD = null; if (!d) return;
  clearTimeout(d.timer); cancelAnimationFrame(d.raf);
  d.el.classList.remove("lifted", "drag-src"); document.body.classList.remove("tape-dragging");
  if (!d.on) return;
  U._suppressClick = Date.now(); // 놓은 자리에서 클릭으로 테이프·상자가 열리지 않게
  if (d.over) d.over.classList.remove("drop-over");
  // 상자 화면 위쪽 점선 자리에 놓으면: 이 상자에서 꺼낸다
  if (drop && d.over && d.over.dataset.unbox) {
    const from = L.boxes.find((b) => b.id === d.over.dataset.unbox), pl = tapeById(d.id);
    d.g.style.transition = "transform .2s ease-in, opacity .2s ease-in"; d.g.style.opacity = "0";
    setTimeout(() => d.g.remove(), 220);
    if (from && from.items.includes(d.id)) setTimeout(() => { moveTapes([d.id], null); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${from.name}」 상자에서 꺼냈어요`); }, 180);
    return;
  }
  const bx = drop && d.over && L.boxes.find((b) => b.id === d.over.dataset.box);
  if (!bx) { d.g.remove(); return; }
  // 상자 속으로 쏙 들어가는 움직임 뒤에 옮긴다
  const r = d.over.getBoundingClientRect(), gr = d.g.getBoundingClientRect();
  d.g.style.transition = "transform .22s ease-in, opacity .22s ease-in";
  d.g.style.transform = `translate(${r.left + r.width / 2 - gr.width * 0.15}px, ${r.top + r.height * 0.3}px) scale(.3)`;
  d.g.style.opacity = "0";
  setTimeout(() => d.g.remove(), 240);
  const pl = tapeById(d.id), had = boxOf(d.id);
  if (had === bx) { toast("이미 들어 있어요"); return; }
  setTimeout(() => { moveTapes([d.id], bx); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${bx.name}」 상자에 넣었어요`); }, 200);
}
// 마우스
view.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || e.button !== 0 || TD) return;
  const el = dragSrc(e.target); if (!el || e.target.closest("button")) return;
  TD = { el, id: el.dataset.pl, sx: e.clientX, sy: e.clientY, on: false };
});
window.addEventListener("pointermove", (e) => {
  if (!TD || e.pointerType === "touch") return;
  if (!TD.on) { if (Math.hypot(e.clientX - TD.sx, e.clientY - TD.sy) < 6) return; tdLift(e.clientX, e.clientY); }
  else tdMove(e.clientX, e.clientY);
});
window.addEventListener("pointerup", (e) => { if (TD && e.pointerType !== "touch") tdEnd(true); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && TD) tdEnd(false); });
view.addEventListener("dragstart", (e) => { if (e.target.closest && e.target.closest(".tape-grid .tape")) e.preventDefault(); }); // 앨범아트 이미지가 끌려 나가지 않게
// 터치
view.addEventListener("touchstart", (e) => {
  if (TD || e.touches.length !== 1) return;
  const el = dragSrc(e.target); if (!el || e.target.closest("button")) return;
  const p = e.touches[0];
  TD = { el, id: el.dataset.pl, sx: p.clientX, sy: p.clientY, on: false, armed: false, touch: true };
  TD.timer = setTimeout(() => { if (!TD) return; TD.armed = true; el.classList.add("lifted"); if (navigator.vibrate) navigator.vibrate(12); }, 380);
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!TD || !TD.touch) return;
  const p = e.touches[0];
  if (!TD.armed) { if (Math.hypot(p.clientX - TD.sx, p.clientY - TD.sy) > 8) { clearTimeout(TD.timer); TD = null; } return; } // 그냥 스크롤
  e.preventDefault();
  if (!TD.on) { if (Math.hypot(p.clientX - TD.sx, p.clientY - TD.sy) < 6) return; tdLift(p.clientX, p.clientY); }
  else tdMove(p.clientX, p.clientY);
}, { passive: false });
const touchUp = (e) => {
  if (!TD || !TD.touch) return;
  const d = TD;
  if (d.on) { tdEnd(e.type === "touchend"); return; }
  tdEnd(false);
  if (d.armed && e.type === "touchend") { U._suppressClick = Date.now(); tapeMenu(d.id, d.sx, d.sy); } // 끌지 않고 뗐으면 메뉴
};
document.addEventListener("touchend", touchUp);
document.addEventListener("touchcancel", touchUp);
U.onContext(document, ".row[data-id], .card[data-id]", (el, x, y) => {
  if (el.closest(".add-finder") || el.closest("#fullplayer")) return;
  const lst = el.closest("[data-list]");
  trackMenu(el.dataset.id, x, y, { list: lst ? lst.dataset.list : "", i: +el.dataset.i, sel: !!el.closest("#view") });
});

// 키보드 (PC)
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select")) return;
  if (e.code === "Space") { e.preventDefault(); P.toggle(); }
  else if (e.code === "ArrowRight" && e.shiftKey) P.next();
  else if (e.code === "ArrowLeft" && e.shiftKey) P.prev();
  else if (e.code === "ArrowRight") P.seek(Math.min(P.dur, P.pos + 5000));
  else if (e.code === "ArrowLeft") P.seek(Math.max(0, P.pos - 5000));
  else if (e.key === "/" ) { e.preventDefault(); location.hash = "#/search"; }
  else if (e.code === "Escape") { if (SEL.on && menu.hidden && modal.hidden && fp.hidden) { selEnd(); return; } closeMenu(); closeModal(); closeFull(); }
});

// 안드로이드 뒤로 가기: 처리했으면 true
window.__back = () => {
  if (!menu.hidden) { closeMenu(); return true; }
  if (!modal.hidden) { closeModal(); return true; }
  if (!fp.hidden) { closeFull(); return true; }
  if (SEL.on) { selEnd(); return true; }
  if (route().name !== "home") { history.back(); return true; }
  return false;
};

// ───────── 여러 곡 선택 → 현재 재생목록으로 묶어 재생 ─────────
// ids는 고른 순서대로. 재생하면 그 순서가 그대로 지금 듣는 (임시) 재생목록이 된다
const SEL = { on: false, ids: [], list: "", last: null };
const selBtn = (list, keep) => `<button class="icon-btn sel-btn${keep ? "" : " m-only"}" data-act="sel-start" data-list="${esc(list)}" title="여러 곡 선택"><i class="ic ic-checkbox"></i></button>`;
function selStart(id, list) {
  SEL.on = true; SEL.list = list || SEL.list;
  if (id && !SEL.ids.includes(id)) { SEL.ids.push(id); SEL.last = id; }
  $$(".row.sel").forEach((r) => r.classList.remove("sel"));
  syncSel();
}
function selEnd() { SEL.on = false; SEL.ids = []; SEL.list = ""; SEL.last = null; syncSel(); }
function selPick(el, range) {
  const id = el.dataset.id, box = el.closest("[data-list]"), name = box ? box.dataset.list : "";
  const arr = name && lists[name];
  if (range && SEL.last && arr && arr.includes(SEL.last) && arr.includes(id)) {
    // Shift: 마지막으로 고른 곡부터 여기까지 목록 순서대로 모두
    const a = arr.indexOf(SEL.last), b = arr.indexOf(id);
    arr.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => { if (!SEL.ids.includes(x)) SEL.ids.push(x); });
  } else {
    const k = SEL.ids.indexOf(id);
    if (k >= 0) SEL.ids.splice(k, 1); else SEL.ids.push(id);
  }
  SEL.last = id; if (name) SEL.list = name;
  syncSel();
}
// 모두 선택: 마지막으로 고른 목록 전체 (스크롤해야 보이는 곡까지). 이미 다 골랐으면 모두 해제
function selScope() {
  if (SEL.list && lists[SEL.list] && $(`#view [data-list="${CSS.escape(SEL.list)}"]`)) return lists[SEL.list];
  const seen = []; $$("#view .row[data-id], #view .card[data-id]").forEach((el) => { if (!el.closest(".add-finder") && !seen.includes(el.dataset.id)) seen.push(el.dataset.id); });
  return seen;
}
function selAll() {
  const scope = selScope();
  if (scope.length && scope.every((id) => SEL.ids.includes(id))) SEL.ids = SEL.ids.filter((id) => !scope.includes(id));
  else scope.forEach((id) => { if (!SEL.ids.includes(id)) SEL.ids.push(id); });
  syncSel();
}
// 목록 머리의 체크박스: 그 목록을 모두 고르고, 이미 다 골랐으면 모두 풀고 선택을 끝낸다
function selHead(btn) {
  const box = btn.closest("[data-list]"), name = box && box.dataset.list, arr = name && lists[name];
  if (!arr || !arr.length) return;
  if (SEL.on && arr.every((id) => SEL.ids.includes(id))) {
    SEL.ids = SEL.ids.filter((id) => !arr.includes(id));
    if (!SEL.ids.length) { selEnd(); return; }
  } else {
    if (!SEL.on) { SEL.on = true; $$(".row.sel").forEach((r) => r.classList.remove("sel")); }
    arr.forEach((id) => { if (!SEL.ids.includes(id)) SEL.ids.push(id); });
  }
  SEL.list = name; syncSel();
}
function markPicked() {
  const set = new Set(SEL.ids);
  $$("#view .row[data-id], #view .card[data-id]").forEach((el) => el.classList.toggle("picked", set.has(el.dataset.id)));
  $$('#view [data-list] > .tl-head [data-act="sel-head"]').forEach((b) => {
    const arr = lists[b.closest("[data-list]").dataset.list] || [];
    const n = arr.filter((id) => set.has(id)).length;
    b.classList.toggle("on", SEL.on && n > 0 && n === arr.length);
    b.classList.toggle("some", SEL.on && n > 0 && n < arr.length);
  });
}
function syncSel() {
  document.body.classList.toggle("selecting", SEL.on);
  markPicked();
  const b = $("#selbar"); if (!b) return;
  b.hidden = !SEL.on;
  if (!SEL.on) { b.innerHTML = ""; return; }
  const n = SEL.ids.length, scope = selScope(), all = scope.length && scope.every((id) => SEL.ids.includes(id));
  const ms = SEL.ids.reduce((s, id) => s + ((L.byId.get(id) || {}).duration || 0), 0);
  const dis = n ? "" : " disabled";
  b.innerHTML = `<div class="selbar-box">
    <button class="icon-btn" data-act="sel-cancel" title="선택 끝내기"><i class="ic ic-x"></i></button>
    <div class="selbar-count"><b>${n ? U.num(n) + "곡 선택" : "곡을 골라 주세요"}</b>${n ? `<span>${esc(fmtTotal(ms))}</span>` : ""}</div>
    <button class="btn ghost selbar-all" data-act="sel-all">${all ? "모두 해제" : "모두 선택"}</button>
    <button class="icon-btn" data-act="sel-addpl" title="테이프에 담기"${dis}><i class="ic ic-stack"></i></button>
    <button class="icon-btn" data-act="sel-next" title="다음에 재생"${dis}><i class="ic ic-queue"></i></button>
    <button class="icon-btn" data-act="sel-shuffle" title="섞어서 재생"${dis}><i class="ic ic-shuffle"></i></button>
    <button class="selbar-play" data-act="sel-play" title="고른 곡을 바로 재생"${dis}><i class="ic ic-play"></i><span>재생</span></button>
  </div>`;
}

// ───────── 재생 상태 반영 ─────────
let lastId = null;
let widgetName = null;
function syncWidgetName() {
  try { if (window.NativeBridge && NativeBridge.setTapeName && P.current) { const n = contextTape().name; if (n !== widgetName) { widgetName = n; NativeBridge.setTapeName(n); } } } catch (e) {}
}
function onState() {
  const id = P.currentId;
  const changed = id !== lastId; lastId = id;
  renderBar(); refreshHomeNow();
  if (changed) syncWidgetName(); // 상자 통째 재생에서 다음 테이프로 넘어가면 위젯 테이프 이름도
  $$(".row.now, .lp.now, .card.now").forEach((r) => r.classList.remove("now", "paused"));
  if (id) {
    $$(`:is(.row, .card)[data-id="${CSS.escape(id)}"]`).forEach((r) => { r.classList.add("now"); r.classList.toggle("paused", !P.playing); });
    $$(`.lp[data-album="${CSS.escape(albumKeyOf(P.current))}"]`).forEach((r) => { r.classList.add("now"); r.classList.toggle("paused", !P.playing); });
  }
  // 테이프: 지금 듣는 재생목록이면 릴이 돈다. 곡이 바뀌면 띠를 다시 적는다
  if (changed && $("#view .tape[data-plid]")) rerender();
  else $$("#view .tape[data-plid]").forEach((el) => { el.classList.toggle("now", isPlayingPl({ id: el.dataset.plid })); el.classList.toggle("paused", !P.playing); });
  if (changed) renderSidebar();
  else $$("#side-playlists .tape[data-plid]").forEach((el) => { el.classList.toggle("now", isPlayingPl({ id: el.dataset.plid })); el.classList.toggle("paused", !P.playing); });
  if (changed) { renderPanel(); renderFull(); if (id) getLyrics(id); }
  else syncFullControls();
  document.title = P.current ? `${P.current.title} · ${P.current.artist}` : "테이프 박스";
}
function onPlayed({ id }) {
  const t = L.byId.get(id); if (!t) return;
  const now = Date.now();
  t.plays++; t.lastPlayed = now; if (!t.firstPlayed) t.firstPlayed = now;
  const a = L.albums.get(t.albumKey); if (a) { a.plays++; a.lastPlayed = now; }
  t._artists.forEach((n) => { const r = L.artists.get(n); if (r) r.plays++; });
}
