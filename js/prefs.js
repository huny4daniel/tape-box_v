// 기기를 가리지 않는 화면 상태: 폰 DB(kv)에 두어 폰 화면과 PC 화면이 같은 값을 본다.
//  - tapePlayed: 테이프를 마지막으로 들은 때 { 기록 열쇠: 시각 } (홈 「최근 들은 테이프」, 사이드바 순서)
//  - boxHidden:  숨긴 시스템·히스토리 상자 { 상자 id: true }
//  - libSort, col: 라이브러리·곡 목록의 정렬과 거르기
// 음량·패널 열림처럼 그 기기에서만 의미 있는 것은 계속 localStorage에 둔다.
// 바꿀 때는 바뀐 부분만 보내고 폰이 합친다(객체 값은 한 단계 아래까지 합침, null이면 지움) — 두 기기가 동시에 써도 서로 덮지 않게.
(function () {
  "use strict";
  const KEYS = { tapePlayed: "mc.tapePlayed", libSort: "mc.libsort", col: "mc.col" }; // 예전에 이 기기에 두던 자리
  let data = {};

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function mergeInto(dst, patch) {
    for (const k in patch) {
      const v = patch[k];
      if (v === null) delete dst[k];
      else if (isObj(v) && isObj(dst[k])) { for (const kk in v) { if (v[kk] === null) delete dst[k][kk]; else dst[k][kk] = v[kk]; } }
      else dst[k] = isObj(v) ? Object.assign({}, v) : v;
    }
  }
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
    keys: () => { try { return Object.keys(localStorage); } catch (e) { return []; } },
  };

  // 이 기기에 남아 있던 예전 값을 한 번만 폰으로 올린다 (폰에 이미 값이 있으면 합친다)
  function oldLocal() {
    const up = {};
    for (const k in KEYS) { const raw = ls.get(KEYS[k]); if (raw) { try { const v = JSON.parse(raw); if (isObj(v)) up[k] = v; } catch (e) {} } }
    const hidden = {};
    ls.keys().filter((k) => k.startsWith("mc.box.hidden.")).forEach((k) => { if (ls.get(k) === "1") hidden[k.slice(14)] = true; });
    if (Object.keys(hidden).length) up.boxHidden = hidden;
    return up;
  }
  function forgetOldLocal() {
    for (const k in KEYS) ls.del(KEYS[k]);
    ls.keys().filter((k) => k.startsWith("mc.box.hidden.")).forEach(ls.del);
  }

  async function load() {
    try { const d = await API.prefs(); data = isObj(d) ? d : {}; } catch (e) { data = oldLocal(); return data; } // 예전 폰 앱이면 이 기기에 있던 값으로
    const up = oldLocal();
    if (Object.keys(up).length) {
      // 이 기기 기록이 더 최근일 수 있는 tapePlayed는 열쇠마다 늦은 쪽을 남긴다. 나머지는 폰에 이미 있으면 폰 것을 따른다
      if (up.tapePlayed && isObj(data.tapePlayed)) for (const k in up.tapePlayed) if ((data.tapePlayed[k] || 0) >= up.tapePlayed[k]) delete up.tapePlayed[k];
      for (const k of ["libSort", "col"]) if (up[k] && isObj(data[k])) delete up[k];
      try { if (Object.keys(up).length) data = await API.setPrefs(up); forgetOldLocal(); } catch (e) {}
    }
    return data;
  }
  const get = (k, def) => (k in data ? data[k] : def);
  // 화면은 바로 바뀐 값을 쓰고, 폰에는 뒤에서 보낸다
  function set(patch) {
    mergeInto(data, patch);
    return API.setPrefs(patch).catch(() => {});
  }

  window.Prefs = { load, get, set, _mergeInto: mergeInto };
})();
