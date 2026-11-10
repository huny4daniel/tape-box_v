// 공통 도구: 글자 처리, 시간·날짜 표시, 앨범아트 자리 표시, 초성 검색
(function () {
  "use strict";
  const U = {};

  U.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  U.attr = U.esc;

  U.hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  U.fmtDur = (ms) => {
    if (!ms || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  U.fmtLong = (ms) => { // "3시간 12분"
    const m = Math.round((ms || 0) / 60000);
    if (m < 60) return m + "분";
    const h = Math.floor(m / 60);
    return h + "시간" + (m % 60 ? " " + (m % 60) + "분" : "");
  };
  U.fmtHours = (ms) => {
    const h = (ms || 0) / 3600000;
    return h >= 10 ? Math.round(h).toLocaleString("ko-KR") : h.toFixed(1);
  };
  U.fmtDate = (t) => {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };
  U.fmtDateKo = (t) => {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  };
  U.monthKey = (t) => { const d = new Date(t); return d.getFullYear() * 100 + d.getMonth() + 1; };
  U.monthLabel = (k) => Math.floor(k / 100) + "년 " + (k % 100) + "월";
  U.daysAgo = (t) => Math.floor((Date.now() - t) / 86400000);
  U.ago = (t) => {
    if (!t) return "";
    const d = U.daysAgo(t);
    if (d <= 0) return "오늘";
    if (d === 1) return "어제";
    if (d < 7) return d + "일 전";
    if (d < 30) return Math.floor(d / 7) + "주 전";
    if (d < 365) return Math.floor(d / 30) + "개월 전";
    return Math.floor(d / 365) + "년 전";
  };
  U.num = (n) => (n || 0).toLocaleString("ko-KR");
  U.no = (n) => String(n || 0).padStart(4, "0");

  // 앨범아트가 없을 때 쓰는 색: 앨범 이름에서 정해진 색을 고른다
  U.hue = (seed) => U.hash(seed || "") % 360;
  U.phStyle = (seed) => {
    const h = U.hue(seed);
    return `--ph:linear-gradient(135deg,hsl(${h} 38% 34%),hsl(${(h + 40) % 360} 42% 18%))`;
  };
  U.initial = (s) => {
    s = String(s || "").replace(/^[\s\(\[]+/, "");
    return s ? Array.from(s)[0].toUpperCase() : "♪";
  };

  // 초성 검색
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  U.chosung = (s) => {
    let out = "";
    for (const ch of String(s || "")) {
      const c = ch.charCodeAt(0);
      if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
      else out += ch;
    }
    return out;
  };
  U.isChoQuery = (q) => /^[ㄱ-ㅎ\s]+$/.test(q);
  U.norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  U.seeded = (seed) => { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507); s = Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; }; };
  U.pick = (arr, n, rnd) => { rnd = rnd || Math.random; const a = arr.slice(); const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };

  // 이미지에서 화면 배경색을 뽑는다 (어두운 배경에 어울리게 채도·밝기를 맞춤)
  const colorCache = new Map();
  U.tintFrom = (url, seed) => new Promise((resolve) => {
    const fallback = () => { const h = U.hue(seed); return `${h} 30% 28%`; };
    if (!url) return resolve(fallback());
    if (colorCache.has(url)) return resolve(colorCache.get(url));
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        // 채도 높은 픽셀에 가중치를 줘서 평균
        let r = 0, gg = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const wt = 1 + (mx - mn) / 32;
          r += R * wt; gg += G * wt; b += B * wt; w += wt;
        }
        const [h, s] = rgb2hsl(r / w, gg / w, b / w);
        const res = `${Math.round(h)} ${Math.round(Math.min(55, s * 100))}% ${s < 0.08 ? 24 : 30}%`;
        colorCache.set(url, res); resolve(res);
      } catch (e) { resolve(fallback()); }
    };
    img.onerror = () => resolve(fallback());
    img.src = url;
  });
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  // 길게 누르기(폰)·오른쪽 클릭(PC)을 같은 콜백으로
  U.onContext = (root, selector, fn) => {
    root.addEventListener("contextmenu", (e) => {
      const t = e.target.closest(selector); if (!t || !root.contains(t)) return;
      e.preventDefault(); fn(t, e.clientX, e.clientY);
    });
    let timer = null, sx = 0, sy = 0;
    root.addEventListener("touchstart", (e) => {
      const t = e.target.closest(selector); if (!t) return;
      const p = e.touches[0]; sx = p.clientX; sy = p.clientY;
      timer = setTimeout(() => { timer = null; U._suppressClick = Date.now(); if (navigator.vibrate) navigator.vibrate(12); fn(t, sx, sy); }, 480);
    }, { passive: true });
    const cancel = (e) => {
      if (!timer) return;
      if (e.type === "touchmove") { const p = e.touches[0]; if (Math.abs(p.clientX - sx) < 8 && Math.abs(p.clientY - sy) < 8) return; }
      clearTimeout(timer); timer = null;
    };
    root.addEventListener("touchmove", cancel, { passive: true });
    root.addEventListener("touchend", cancel);
  };
  U.clickSuppressed = () => U._suppressClick && Date.now() - U._suppressClick < 600;

  window.U = U;
})();
