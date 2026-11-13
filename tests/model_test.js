// 값 시험 (브라우저 없이): 테이프·상자 규칙(js/tapes.js)과 화면 상태 합치기(js/prefs.js)가 맞는 값을 내는지 본다.
//
//     node --test tests/model_test.js
//
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const DAY = 86400000;
// vm 안에서 만든 배열·객체는 프로토타입이 달라 그대로 비교하면 어긋난다 → 평범한 값으로 바꿔 비교
const eq = (a, b, msg) => assert.deepEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b, msg);

// 화면 파일을 브라우저 대신 vm에서 읽는다. API는 시험마다 가짜로
function load(api) {
  const store = {};
  const ctx = {
    console, Date, Math, JSON, Promise, setTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
    },
    API: api || {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // Object.keys(localStorage)가 저장된 열쇠를 돌려주도록 (브라우저와 같게)
  ctx.localStorage = new Proxy(ctx.localStorage, { ownKeys: () => Object.keys(store), getOwnPropertyDescriptor: (t, k) => (k in store ? { enumerable: true, configurable: true, value: store[k] } : undefined) });
  for (const f of ["js/util.js", "js/prefs.js", "js/tapes.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  ctx.store = store;
  return ctx;
}

function lib(over) {
  const now = Date.now();
  const tracks = [
    { id: "a", n: 1, plays: 10, lastPlayed: now - DAY, addedAt: now - 400 * DAY, fav: true, favAt: now - 5 },
    { id: "b", n: 2, plays: 30, lastPlayed: now - 2 * DAY, addedAt: now - 300 * DAY, fav: true, favAt: now - 1 },
    { id: "c", n: 3, plays: 5, lastPlayed: now - 200 * DAY, addedAt: now - 200 * DAY },
    { id: "d", n: 4, plays: 0, addedAt: now - 3 * DAY },
    { id: "e", n: 5, plays: 0, addedAt: now - 1 * DAY },
  ];
  return Object.assign({
    tracks,
    playlists: [{ id: "p1", name: "하나", items: ["a"] }, { id: "p2", name: "둘", items: ["b"] }, { id: "p3", name: "셋", items: [] }],
    boxes: [{ id: "b1", name: "상자", items: ["p1", "liked", "top"] }],
    history: [{ month: "2026-10", items: ["a", "b"] }, { month: "2026-09", items: [] }],
  }, over || {});
}

test("규칙: 상자에 넣을 수 있는 테이프와 상자", () => {
  const w = load();
  const M = w.TapeModel(lib(), w.U);
  assert.equal(M.canBox("p1"), true);
  for (const id of ["liked", "top", "dailymix", "hist-2026-10", "tmp-3"]) assert.equal(M.canBox(id), false, id);
  assert.equal(M.canBoxInto("b1"), true);
  assert.equal(M.canBoxInto("sys"), false);
  assert.equal(M.canBoxInto("hist"), false);
  assert.equal(M.tapeHref({ id: "liked" }), "#/liked");
  assert.equal(M.tapeHref({ id: "a b" }), "#/playlist/a%20b");
});

test("시스템 테이프의 곡", () => {
  const w = load();
  const M = w.TapeModel(lib(), w.U);
  eq(M.likedPl().items, ["b", "a"], "아끼는 곡: 최근에 누른 순");
  eq(M.systemTape("top").items, ["b", "a", "c"], "단골 곡: 많이 들은 순, 안 들은 곡 제외");
  eq(M.systemTape("unheard").items, ["e", "d"], "아직 못 들은 곡: 최근에 들인 순");
  eq(M.systemTape("fresh").items, ["e", "d"], "새로 들인 곡: 30일 안");
  eq(M.systemTape("longago").items, ["c"], "오랜만이에요: 3번 넘게 듣고 90일 넘게 못 들은 곡");
  const mix = M.systemTape("dailymix").items;
  assert.equal(new Set(mix).size, mix.length, "오늘의 믹스: 겹치는 곡 없음");
  eq(M.systemTape("dailymix").items, [...mix], "오늘의 믹스: 같은 날에는 같은 곡");
});

test("히스토리 상자", () => {
  const w = load();
  const M = w.TapeModel(lib(), w.U);
  const box = M.histBox();
  eq([...box.items], ["hist-2026-10"], "곡이 없는 달은 빼고");
  const t = M.histTape("hist-2026-10");
  assert.equal(t.name, "2026. 10.");
  eq([...t.items], ["a", "b"]);
  assert.equal(M.histTape("hist-2020-01"), null);
});

test("상자 안의 테이프와 어느 상자에 들었는지", () => {
  const w = load();
  const M = w.TapeModel(lib(), w.U);
  const b1 = M.allBoxes().find((b) => b.id === "b1");
  eq(M.boxTapes(b1).map((t) => t.id), ["p1"], "내 상자에 예전에 넣어 둔 시스템 테이프는 무시");
  assert.equal(M.boxOf("p1").id, "b1");
  assert.equal(M.boxOf("p2"), undefined);
  assert.equal(M.boxOf("top").id, "sys");
  assert.equal(M.boxOf("hist-2026-10").id, "hist");
  eq(M.pinSystemBoxes([{ id: "b9" }, { id: "hist", system: true }, { id: "sys", system: true }]).map((b) => b.id), ["sys", "hist", "b9"]);
});

test("상자 숨기기는 화면 상태(Prefs)에 저장되고 목록에서 빠진다", () => {
  const sent = [];
  const w = load({ setPrefs: (p) => { sent.push(JSON.parse(JSON.stringify(p))); return Promise.resolve({}); } });
  const M = w.TapeModel(lib(), w.U);
  eq(M.allBoxes().map((b) => b.id), ["sys", "hist", "b1"]);
  M.setBoxHidden("sys", true);
  eq(M.allBoxes().map((b) => b.id), ["hist", "b1"]);
  assert.equal(M.boxOf("top"), null);
  M.setBoxHidden("sys", false);
  eq(M.allBoxes().map((b) => b.id), ["sys", "hist", "b1"]);
  eq(sent, [{ boxHidden: { sys: true } }, { boxHidden: { sys: null } }], "바뀐 부분만 보낸다");
});

test("화면 상태 합치기: null은 지우고, 객체는 한 단계 아래까지 합친다", () => {
  const w = load();
  const d = { tapePlayed: { p1: 1 }, libSort: { albums: "recent" } };
  w.Prefs._mergeInto(d, { tapePlayed: { p2: 2 }, libSort: { artists: "plays" }, col: { sort: "title" } });
  eq(d, { tapePlayed: { p1: 1, p2: 2 }, libSort: { albums: "recent", artists: "plays" }, col: { sort: "title" } });
  w.Prefs._mergeInto(d, { tapePlayed: { p1: null }, col: null });
  eq(d, { tapePlayed: { p2: 2 }, libSort: { albums: "recent", artists: "plays" } });
});

test("예전에 이 기기에 저장한 값은 처음 한 번 폰으로 올리고 지운다", async () => {
  let server = { tapePlayed: { p1: 500, p2: 100 }, libSort: { albums: "name" } };
  const ups = [];
  const w = load({
    prefs: () => Promise.resolve(JSON.parse(JSON.stringify(server))),
    setPrefs: (p) => { ups.push(JSON.parse(JSON.stringify(p))); w.Prefs._mergeInto(server, JSON.parse(JSON.stringify(p))); return Promise.resolve(JSON.parse(JSON.stringify(server))); },
  });
  w.localStorage.setItem("mc.tapePlayed", JSON.stringify({ p1: 300, p2: 200, p3: 50 }));
  w.localStorage.setItem("mc.libsort", JSON.stringify({ albums: "recent" }));
  w.localStorage.setItem("mc.box.hidden.hist", "1");
  w.localStorage.setItem("mc.vol", "0.5");
  await w.Prefs.load();
  eq(ups, [{ tapePlayed: { p2: 200, p3: 50 }, boxHidden: { hist: true } }], "더 늦은 기록만, 폰에 이미 있는 정렬은 폰 것");
  eq(w.Prefs.get("tapePlayed"), { p1: 500, p2: 200, p3: 50 });
  assert.equal(w.Prefs.get("libSort").albums, "name");
  eq(Object.keys(w.store).sort(), ["mc.vol"], "옮긴 것만 지우고 이 기기 전용 값(음량)은 남긴다");
});

test("예전 폰 앱(화면 상태 API 없음)이면 이 기기에 있던 값을 쓴다", async () => {
  const w = load({ prefs: () => Promise.reject(new Error("404")), setPrefs: () => Promise.reject(new Error("404")) });
  w.localStorage.setItem("mc.box.hidden.sys", "1");
  await w.Prefs.load();
  eq(w.Prefs.get("boxHidden"), { sys: true });
});

test("랜덤 테이프: 꽂기 전까지는 같은 곡, 꽂으면 새로 고른다", () => {
  const w = load();
  const tracks = Array.from({ length: 100 }, (_, i) => ({ id: "t" + i, n: i + 1, plays: 0, addedAt: 0 }));
  const M = w.TapeModel(lib({ tracks }), w.U);
  assert.ok(M.SYS_IDS.includes("random"), "시스템 상자에 들어 있음");
  assert.equal(M.canBox("random"), false, "내 상자로는 못 옮김");
  const a = JSON.parse(JSON.stringify(M.systemTape("random").items));
  assert.equal(a.length, 30);
  assert.equal(new Set(a).size, 30, "겹치는 곡 없음");
  eq(M.systemTape("random").items, a, "다시 봐도 같은 30곡");
  M.reshuffleTape("top");
  eq(M.systemTape("random").items, a, "다른 테이프를 꽂으면 그대로");
  M.reshuffleTape("random");
  assert.notDeepEqual(JSON.parse(JSON.stringify(M.systemTape("random").items)), a, "꽂으면 새 30곡");
});
