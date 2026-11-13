// 테이프·상자 규칙: 어떤 테이프가 있고, 어느 상자에 들어 있고, 무엇을 고칠 수 있는지.
//  - 내가 만든 테이프·상자 (폰 DB: L.playlists, L.boxes)
//  - 아끼는 곡과 시스템 상자의 테이프 (곡 기록으로 그때그때 만든다)
//  - 히스토리 상자의 테이프 (폰 DB에 쌓인 달별 기록: L.history)
// 특별한 테이프를 늘리거나 규칙을 바꿀 때는 이 파일만 고치면 되도록 한곳에 모았다. 화면 코드는 여기서 받아 쓴다.
(function () {
  "use strict";
  window.TapeModel = function (L, U) {
    const likedPl = () => ({ id: "liked", name: "아끼는 곡", items: L.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || b.n) - (a.favAt || a.n)).map((t) => t.id) });

    // ── 시스템 상자: 사용자가 만들지 않아도 늘 있는 상자. 기록으로 저절로 채워지는 테이프들이 들어 있다 ──
    //  - 이름 바꾸기·삭제·테이프 넣고 빼기는 안 되고, 숨기기만 된다 (숨기면 설정에서 다시 켠다. 폰 DB에 저장해 폰·PC가 같이 본다)
    //  - 안의 테이프는 곡을 직접 고칠 수 없고 다른 상자로도 못 옮긴다. 파일로 저장하는 대상도 아니다 (폰 DB에 없는 화면 속 테이프)
    const SYS_BOX = "sys";
    const SYS_TAPES = [
      ["liked", "아끼는 곡", "하트를 누른 곡, 최근에 누른 순"],
      ["top", "단골 곡", "가장 많이 들은 50곡"],
      ["fresh", "새로 들인 곡", "최근 30일 안에 컬렉션에 들어온 곡"],
      ["longago", "오랜만이에요", "예전에 자주 들었지만 90일 넘게 못 들은 곡"],
      ["unheard", "아직 못 들은 곡", "한 번도 듣지 않은 곡"],
      ["onthisday", "그해 오늘", "몇 년 전 이맘때(앞뒤 2주) 컬렉션에 들인 곡"],
      ["dailymix", "오늘의 믹스", "아끼는 곡·단골 곡·오랜만인 곡을 섞은 30곡, 날마다 바뀐다"],
    ];
    const SYS_IDS = SYS_TAPES.map((x) => x[0]);
    const isHistTape = (id) => String(id).startsWith("hist-");
    const isSysTape = (id) => SYS_IDS.includes(id) || isHistTape(id); // 시스템·히스토리 상자의 테이프 (편집·옮기기 안 됨)
    // 숨긴 상자는 폰 DB에 (폰에서 숨기면 PC에서도 숨는다)
    const boxHidden = (id) => !!Prefs.get("boxHidden", {})[id];
    const setBoxHidden = (id, on) => Prefs.set({ boxHidden: { [id]: on ? true : null } });
    const sysHidden = () => boxHidden("sys"), histHidden = () => boxHidden("hist");
    // 히스토리 상자: 달마다 그 달에 가장 많이 들은 30곡. 이번 달은 듣는 대로 바뀌고, 다음 달 1일이 되면 그대로 굳는다
    const thisMonth = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
    function histTape(id) {
      const month = String(id).slice(5), h = (L.history || []).find((x) => x.month === month); if (!h) return null;
      const [y, m] = month.split("-"), now = month === thisMonth();
      return { id, name: `${y}. ${+m}.`, desc: `${y}년 ${+m}월에 가장 많이 들은 ${h.items.length}곡${now ? " · 이번 달은 듣는 대로 바뀌어요" : ""}`, items: h.items, system: true, history: true };
    }
    const histBox = () => ({ id: "hist", name: "히스토리 상자", items: (L.history || []).filter((h) => h.items.length).map((h) => "hist-" + h.month), system: true, history: true, created: 0, updated: 0 });
    const DAY_MS = 86400000;
    let sysCache = { at: 0, map: new Map() }; // 곡 3천 개를 매번 훑지 않게 잠깐(2초) 기억해 둔다
    function systemTape(id) {
      if (id === "liked") return Object.assign(likedPl(), { system: true, desc: SYS_TAPES[0][2] });
      const def = SYS_TAPES.find((x) => x[0] === id); if (!def) return null;
      const now = Date.now();
      if (now - sysCache.at > 2000) sysCache = { at: now, map: new Map() };
      if (!sysCache.map.has(id)) {
        const T = L.tracks, ids = (arr) => arr.map((t) => t.id);
        let items = [];
        if (id === "top") items = ids(T.filter((t) => t.plays).sort((a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 50));
        else if (id === "fresh") { const r = T.filter((t) => t.addedAt >= now - 30 * DAY_MS).sort((a, b) => b.n - a.n); items = ids(r.length ? r : T.slice().sort((a, b) => b.n - a.n).slice(0, 30)); }
        else if (id === "longago") items = ids(T.filter((t) => t.plays >= 3 && t.lastPlayed && now - t.lastPlayed > 90 * DAY_MS).sort((a, b) => b.plays - a.plays).slice(0, 50));
        else if (id === "unheard") items = ids(T.filter((t) => !t.plays).sort((a, b) => b.n - a.n).slice(0, 200));
        else if (id === "onthisday") {
          const d = new Date(now), y = d.getFullYear();
          const doy = (x) => Math.floor((Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) - Date.UTC(x.getFullYear(), 0, 0)) / DAY_MS);
          const today = doy(d);
          items = ids(T.filter((t) => { if (!t.addedAt) return false; const a = new Date(t.addedAt); if (a.getFullYear() >= y) return false; const diff = Math.abs(doy(a) - today); return Math.min(diff, 365 - diff) <= 14; }).sort((a, b) => b.addedAt - a.addedAt));
        } else if (id === "dailymix") {
          const rnd = U.seeded(Number(new Date(now).toISOString().slice(0, 10).replace(/-/g, "")));
          const pool = [...new Set([...likedPl().items, ...systemTape("top").items, ...systemTape("longago").items])];
          const pick = U.pick(pool, Math.min(30, pool.length), rnd);
          if (pick.length < 30) pick.push(...U.pick(T.map((t) => t.id).filter((x) => !pick.includes(x)), 30 - pick.length, rnd)); // 기록이 적으면 컬렉션에서 채운다
          items = pick;
        }
        sysCache.map.set(id, items);
      }
      return { id, name: def[1], desc: def[2], items: sysCache.map.get(id), system: true };
    }
    const sysBox = () => ({ id: SYS_BOX, name: "시스템 상자", items: SYS_IDS.slice(), system: true, created: 0, updated: 0 });
    // 화면에 보이는 상자들: 시스템 상자(숨기지 않았으면) + 내가 만든 상자
    const allBoxes = () => (sysHidden() ? [] : [sysBox()]).concat(histHidden() ? [] : [histBox()], L.boxes);
    const tapeById = (id) => isHistTape(id) ? histTape(id) : isSysTape(id) ? systemTape(id) : L.playlists.find((p) => p.id === id);
    const boxOf = (plId) => isHistTape(plId) ? (histHidden() ? null : histBox()) : isSysTape(plId) ? (sysHidden() ? null : sysBox()) : L.boxes.find((b) => b.items.includes(plId));
    const boxTapes = (b) => b.items.filter((id) => b.system || !isSysTape(id)).map(tapeById).filter(Boolean); // 내 상자에 예전에 넣어 둔 아끼는 곡 등은 무시

    // 상자 목록: 시스템 상자 → 히스토리 상자를 늘 맨 앞에, 나머지는 받은 순서 그대로
    const pinSystemBoxes = (list) => list.filter((b) => b.id === "sys").concat(list.filter((b) => b.id === "hist"), list.filter((b) => !b.system));

    // 규칙 (화면 코드는 문자열을 직접 비교하지 말고 이것들을 쓴다)
    const isTempTape = (id) => String(id).startsWith("tmp-"); // 재생 화면에서만 있던 임의 테이프 (메모리에만)
    const isSystemBox = (id) => id === SYS_BOX || id === "hist";
    const canBox = (id) => !isSysTape(id) && !isTempTape(id); // 내 상자에 넣을 수 있는 테이프인가 (= 폰 DB의 테이프)
    const canBoxInto = (boxId) => !isSystemBox(boxId); // 테이프를 넣을 수 있는 상자인가
    const canEditTape = (id) => canBox(id); // 곡을 넣고 빼고 이름을 고칠 수 있는 테이프인가
    const tapeHref = (pl) => (pl.id === "liked" ? "#/liked" : "#/playlist/" + encodeURIComponent(pl.id));

    return { isTempTape, isSystemBox, canBox, canBoxInto, canEditTape, tapeHref, likedPl, SYS_BOX, SYS_TAPES, SYS_IDS, isHistTape, isSysTape, boxHidden, setBoxHidden, sysHidden, histHidden, thisMonth, histTape, histBox, systemTape, sysBox, allBoxes, tapeById, boxOf, boxTapes, pinSystemBoxes };
  };
})();
