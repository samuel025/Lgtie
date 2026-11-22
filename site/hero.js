// Draws a real compiled circuit (the NAND gates of a published rule set) and lights it up with live answers.
// Used by the home hero (the warranty circuit, circuit #13 on X Layer) and by the checker page ("watch the circuit work").
// Static and dependency-free. Evaluation here is a local simulation of the same gates; the on-chain check lives elsewhere.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg", TB = window.TB;
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  // Place inputs on the left, gates in columns by depth, outputs on the right. Order each column by the average height of its sources.
  function layout(C, W, H) {
    const nIn = C.nIn, nG = C.gates.length, N = nIn + nG, padX = 22, padY = 18, level = new Array(N).fill(0);
    C.gates.forEach((g, k) => { level[nIn + k] = 1 + Math.max(level[g.a - 2], level[g.b - 2]); });
    const maxL = Math.max(1, ...level);
    for (let o = 0; o < C.nOut; o++) level[N - 1 - o] = maxL;               // outputs share the last column
    const cols = Array.from({length: maxL + 1}, () => []); for (let i = 0; i < N; i++) cols[level[i]].push(i);
    const y = new Array(N).fill(0), x = i => padX + level[i] * (W - 2 * padX) / maxL;
    cols.forEach((col, L) => {
      if (L > 0) col.sort((p, q) => { const s = i => { const g = C.gates[i - nIn]; return (y[g.a - 2] + y[g.b - 2]) / 2; }; return s(p) - s(q); });
      col.forEach((i, r) => { y[i] = padY + (r + 1) * (H - 2 * padY) / (col.length + 1); });
    });
    return {nIn, nG, N, x: Array.from({length: N}, (_, i) => x(i)), y, maxL};
  }
  // values: array over nodes (inputs then gates): 1, 0, or -1 (unknown). answers: array of booleans or null for "unknown".
  function evaluate(C, answers) {
    const nIn = C.nIn, v = new Array(nIn + C.gates.length).fill(-1);
    if (!answers || answers.some(a => a === null || a === undefined)) return v;
    const at = r => r === 0 ? 0 : r === 1 ? 1 : v[r - 2];
    for (let i = 0; i < nIn; i++) v[i] = answers[i] ? 1 : 0;
    C.gates.forEach((g, k) => { v[nIn + k] = 1 - (at(g.a) & at(g.b)); });
    return v;
  }
  const resultOf = (C, v) => { let n = 0; for (let o = 0; o < C.nOut; o++) n += v[v.length - C.nOut + o] * (2 ** o); return n; };

  // Build the SVG once; update(answers) lights it up. -> {svg, update(answers) -> result number or null}
  function circuit(container, C, opts = {}) {
    const W = opts.w || 520, H = opts.h || 240, L = layout(C, W, H), svg = el("svg", {viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "A circuit of NAND gates", class: "circ"});
    const wires = [], nodes = [], gw = el("g", {}, svg), gn = el("g", {}, svg), seen = new Set();
    const wire = (from, to) => { const k = from + ">" + to; if (seen.has(k)) return; seen.add(k); const x1 = L.x[from], y1 = L.y[from], x2 = L.x[to], y2 = L.y[to], dx = Math.max(10, (x2 - x1) * .5);
      wires.push({from, e: el("path", {d: `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, class: "w"}, gw)}); };
    C.gates.forEach((g, k) => { const to = L.nIn + k; [g.a, g.b].forEach(r => { if (r >= 2) wire(r - 2, to); }); });
    for (let i = 0; i < L.N; i++) { const isIn = i < L.nIn, isOut = i >= L.N - C.nOut; nodes.push(el("circle", {cx: L.x[i].toFixed(1), cy: L.y[i].toFixed(1), r: isIn ? 7 : isOut ? 7.5 : 5, class: "g " + (isIn ? "in" : isOut ? "out" : "")}, gn)); }
    container.replaceChildren(svg);
    let first = true;
    return {svg, update(answers) {
      const v = evaluate(C, answers);
      wires.forEach(w => { const on = v[w.from] === 1; w.e.classList.toggle("on", on); });
      nodes.forEach((n, i) => { n.classList.toggle("on", v[i] === 1); n.classList.toggle("off", v[i] === 0); });
      first = false; return v[0] === -1 ? null : resultOf(C, v);
    }};
  }

  // ---------- the home hero: seven answers on top, the real circuit in the middle, the verdict below ----------
  let stopFn = null;
  const LABELS = ["Registered", "In warranty", "Authorised seller", "Fault covered", "No excluded cause", "Within usage limit", "Repair covered"];
  const SCENARIOS = [[1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 0, 1, 1], [1, 1, 1, 1, 1, 0, 1], [1, 1, 0, 1, 1, 1, 1], [1, 0, 1, 1, 1, 1, 1]];
  function mountHero(root) {
    stop();
    const P = TB.parse(TB.TEMPLATES.warranty).policy, C = TB.compile(P), nQ = P.questions.length;
    let answers = SCENARIOS[1].map(Boolean), idx = 1, pausedUntil = 0, visible = true, timer = 0, io = null;
    root.innerHTML = `<div class="vqs" role="group" aria-label="Answers"></div><div class="vsvg"></div>
      <div class="vres" aria-live="off"><div class="vlab">Result</div><div class="big"></div><div class="vwhy small"></div></div>
      <p class="vnote small mute">A live simulation of the ${C.gates.length} NAND gates published as circuit #13 on X Layer. Tap an answer to change it. <a href="#verify">Run the real one</a></p>`;
    const qs = root.querySelector(".vqs"), res = root.querySelector(".vres"), big = res.querySelector(".big"), why = res.querySelector(".vwhy");
    const pills = P.questions.map((q, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "vq"; b.innerHTML = `<span class="vn">${i + 1}</span><span class="vl">${LABELS[i] || "Question " + (i + 1)}</span><span class="vy"></span>`;
      b.onclick = () => { answers[i] = !answers[i]; pausedUntil = Date.now() + 9000; paint(true); }; qs.appendChild(b); return b; });
    const circ = circuit(root.querySelector(".vsvg"), C, {w: 520, h: 250, label: "Live simulation of the warranty circuit"});
    let last = "";
    function paint(swap) {
      pills.forEach((b, i) => { b.setAttribute("aria-pressed", String(answers[i])); b.dataset.a = answers[i] ? "1" : "0"; b.querySelector(".vy").textContent = answers[i] ? "Yes" : "No"; });
      const n = circ.update(answers), r = TB.run(P, answers), shown = r.result;     // the rule engine and the gates agree (tested); show the engine's reason
      const text = P.results[n === null ? shown : n]; if (text !== last || swap) { big.textContent = text; why.textContent = r.why; res.classList.remove("pop"); void res.offsetWidth; if (!reduce) res.classList.add("pop"); last = text; }
    }
    paint(false);
    if (!reduce) {
      timer = setInterval(() => { if (!visible || document.hidden || Date.now() < pausedUntil) return; idx = (idx + 1) % SCENARIOS.length; answers = SCENARIOS[idx].map(Boolean); paint(false); }, 3600);
      if ("IntersectionObserver" in window) { io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, {threshold: .15}); io.observe(root); }
    }
    stopFn = () => { clearInterval(timer); if (io) io.disconnect(); stopFn = null; };
  }
  function stop() { if (stopFn) stopFn(); }

  // ---------- counters: numbers that count up when they scroll into view ----------
  function countUps(root) {
    const els = root.querySelectorAll("[data-count]"); if (!els.length) return;
    const run = e => { const to = Number(e.dataset.count), t0 = performance.now(), dur = 1100; if (reduce) { e.textContent = to; return; }
      const f = now => { const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3); e.textContent = Math.round(to * ease); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
    if (!("IntersectionObserver" in window)) { els.forEach(e => { e.textContent = e.dataset.count; }); return; }
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } }), {threshold: .4}); els.forEach(e => io.observe(e));
  }

  window.TB_HERO = {mountHero, stop, circuit, countUps, evaluate};
})();
