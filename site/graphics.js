// Illustrations for the home and How-it-works pages: inline SVG, animated with CSS when they scroll into view. No external assets.
// The animation rules live in index.html; with "reduce motion" the graphics simply sit in their finished state.
(function () {
  "use strict";
  const attr = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ");
  // ---------- the flow: Publish -> Agree -> Answer -> Review -> Result, with a dot travelling along it ----------
  const NODES = [
    {x: 90, label: "Publish", sub: "rules on X Layer", icon: '<rect x="-12" y="-16" width="24" height="32" rx="4"/><path d="M-6-6h12M-6 0h12M-6 6h7"/>'},
    {x: 290, label: "Agree", sub: "reviewer + time limits", icon: '<circle cx="-7" cy="0" r="10"/><circle cx="7" cy="0" r="10"/>'},
    {x: 500, label: "Answer", sub: "same questions", icon: '<path d="M-14-6h12v12h-12z"/><path d="M2-6h12v12H2z"/><path d="M-11 0l3 3 5-6" class="tick"/>'},
    {x: 710, label: "Review", sub: "only the differences", icon: '<path d="M0-16v28M-9 14h18M-16-8h32"/><path d="M-16-8l-6 12h12zM16-8l-6 12h12z"/>'},
    {x: 910, label: "Result", sub: "anyone can re-run", icon: '<circle r="14"/><path d="M-6 0l4 5 8-10"/>'}
  ];
  function flow(compact) {
    const line = NODES.slice(0, -1).map((n, i) => `<line class="fl" style="--i:${i}" x1="${n.x + 40}" y1="100" x2="${NODES[i + 1].x - 40}" y2="100"/>`).join("");
    const nodes = NODES.map((n, i) => `<g transform="translate(${n.x} 100)"><g class="fnode" style="--d:${Math.max(0, (n.x - 90) / 820 * 6.4 - 0.25).toFixed(2)}s"><circle class="fring" r="40"/><g class="ficon">${n.icon}</g></g></g><text class="flab" x="${n.x}" y="172" text-anchor="middle">${n.label}</text>${compact ? "" : `<text class="fsub" x="${n.x}" y="192" text-anchor="middle">${n.sub}</text>`}`).join("");
    return `<div class="flow${compact ? " compact" : ""}" role="img" aria-label="How a dispute settles: publish the rules, agree, both answer, a reviewer decides only the differences, the circuit gives a result anyone can re-run."><svg viewBox="0 0 1000 ${compact ? 190 : 210}" preserveAspectRatio="xMidYMid meet">${line}<circle class="travel" r="7"/>${nodes}</svg></div>`;
  }

  // ---------- six illustrations ----------
  const ill = {
    // 1. publish: rule bars draw in, a NAND gate is drawn, a lock closes
    1: `<svg viewBox="0 0 400 300" class="g g1"><rect class="card" x="24" y="38" width="196" height="224" rx="22"/>
      <rect class="bar b1" x="48" y="70" width="112" height="11" rx="5.5"/><rect class="bar b2" x="48" y="98" width="140" height="11" rx="5.5"/><rect class="bar b3" x="48" y="126" width="92" height="11" rx="5.5"/><rect class="bar b4" x="48" y="154" width="124" height="11" rx="5.5"/>
      <g class="chips"><rect x="48" y="196" width="50" height="26" rx="13" class="chipy"/><text x="73" y="213" text-anchor="middle">yes</text><rect x="108" y="196" width="50" height="26" rx="13" class="chipn"/><text x="133" y="213" text-anchor="middle">no</text></g>
      <path class="arr" d="M232 150h34"/><path class="arr" d="M258 142l10 8-10 8"/>
      <g class="gate"><path class="gp" d="M284 108h26a42 42 0 0 1 0 84h-26z"/><circle class="gb" cx="358" cy="150" r="6"/><path class="gw" d="M268 128h16M268 172h16M364 150h22"/></g>
      <g class="lock"><rect x="318" y="224" width="46" height="34" rx="8"/><path d="M328 224v-9a13 13 0 0 1 26 0v9"/><circle cx="341" cy="241" r="4" class="keyh"/></g><text class="cap" x="341" y="284" text-anchor="middle">on X Layer</text></svg>`,
    // 2. agree: two sides, a reviewer, a card whose items get ticked, then sealed
    2: `<svg viewBox="0 0 400 300" class="g g2"><g class="person pl"><circle cx="58" cy="132" r="20"/><path d="M22 206a36 36 0 0 1 72 0z"/></g><g class="person pr"><circle cx="342" cy="132" r="20"/><path d="M306 206a36 36 0 0 1 72 0z"/></g>
      <g class="person rev"><circle cx="200" cy="34" r="14"/><path d="M174 78a26 26 0 0 1 52 0z"/></g><path class="dot" d="M200 82v30"/>
      <rect class="card" x="118" y="108" width="164" height="150" rx="18"/>
      <g class="row r1"><rect x="136" y="128" width="18" height="18" rx="5"/><path class="ck" d="M140 137l4 4 7-9"/><rect class="rb" x="164" y="132" width="94" height="10" rx="5"/></g>
      <g class="row r2"><rect x="136" y="160" width="18" height="18" rx="5"/><path class="ck" d="M140 169l4 4 7-9"/><rect class="rb" x="164" y="164" width="70" height="10" rx="5"/></g>
      <g class="row r3"><rect x="136" y="192" width="18" height="18" rx="5"/><path class="ck" d="M140 201l4 4 7-9"/><rect class="rb" x="164" y="196" width="84" height="10" rx="5"/></g>
      <g class="seal"><circle cx="200" cy="238" r="14"/><path d="M193 238l5 5 9-11"/></g><text class="cap" x="200" y="288" text-anchor="middle">fixed in advance</text></svg>`,
    // 3. answer: two columns of answers, one row differs
    3: `<svg viewBox="0 0 400 300" class="g g3"><text class="colh" x="108" y="34" text-anchor="middle">Business</text><text class="colh" x="292" y="34" text-anchor="middle">Customer</text>
      ${[0, 1, 2, 3].map(i => { const y = 56 + i * 56, diff = i === 2; return `<g class="arow ar${i}${diff ? " diff" : ""}"><rect class="rowbg" x="30" y="${y - 6}" width="340" height="44" rx="22"/><g class="achip l"><rect x="62" y="${y}" width="92" height="32" rx="16" class="cy"/><text x="108" y="${y + 21}" text-anchor="middle">Yes</text></g><g class="achip r"><rect x="246" y="${y}" width="92" height="32" rx="16" class="${diff ? "cn" : "cy"}"/><text x="292" y="${y + 21}" text-anchor="middle">${diff ? "No" : "Yes"}</text></g>${diff ? '<path class="neq" d="M192 ' + (y + 10) + 'l16 12M208 ' + (y + 10) + 'l-16 12"/>' : '<path class="eq" d="M190 ' + (y + 12) + 'h20M190 ' + (y + 22) + 'h20"/>'}</g>`; }).join("")}</svg>`,
    // 4. review: the disputed row travels to the reviewer, who decides it
    4: `<svg viewBox="0 0 400 300" class="g g4"><g class="agreed"><rect x="24" y="48" width="200" height="34" rx="17"/><path d="M44 65l6 6 10-12" class="t1"/><rect x="24" y="96" width="200" height="34" rx="17"/><path d="M44 113l6 6 10-12" class="t1"/><rect x="24" y="192" width="200" height="34" rx="17"/><path d="M44 209l6 6 10-12" class="t1"/><text class="cap" x="124" y="256" text-anchor="middle">agreed, no one needed</text></g>
      <g class="moving"><rect class="mrow" x="24" y="144" width="200" height="34" rx="17"/><circle class="q1" cx="48" cy="161" r="7"/><text x="124" y="166" text-anchor="middle">Q5 differs</text></g>
      <g class="rv"><circle cx="318" cy="120" r="26"/><path d="M276 204a42 42 0 0 1 84 0z"/><g class="stamp"><circle cx="338" cy="196" r="18"/><path d="M329 196l6 6 11-13"/></g></g><text class="cap" x="318" y="256" text-anchor="middle">one reviewer, one question</text></svg>`,
    // 5. decide: a small circuit lights up and a result appears
    5: `<svg viewBox="0 0 400 300" class="g g5">${[60, 110, 160, 210].map((y, i) => `<circle class="in i${i}" cx="40" cy="${y}" r="10"/>`).join("")}
      <path class="w w1" d="M50 60C110 60 110 85 160 85"/><path class="w w2" d="M50 110C110 110 110 85 160 85"/><path class="w w3" d="M50 160C110 160 110 185 160 185"/><path class="w w4" d="M50 210C110 210 110 185 160 185"/>
      <circle class="gn n1" cx="170" cy="85" r="13"/><circle class="gn n2" cx="170" cy="185" r="13"/><path class="w w5" d="M183 85C230 85 230 135 262 135"/><path class="w w6" d="M183 185C230 185 230 135 262 135"/>
      <circle class="gn n3" cx="274" cy="135" r="13"/><path class="w w7" d="M287 135H318"/><g class="out"><rect x="318" y="112" width="68" height="46" rx="23"/><text x="352" y="140" text-anchor="middle">Covered</text></g>
      <g class="replay"><path d="M92 266a22 22 0 1 1 22 22"/><path d="M114 288l-9-3m9 3l3-9"/></g><text class="cap" x="250" y="280" text-anchor="middle">anyone can re-run it, free</text></svg>`,
    // 6. passkey: a phone, a fingerprint, a signed message sent on by someone with a wallet
    6: `<svg viewBox="0 0 400 300" class="g g6"><rect class="phone" x="40" y="26" width="118" height="236" rx="22"/><rect class="notch" x="84" y="38" width="30" height="6" rx="3"/>
      <g class="fp"><circle class="r1" cx="99" cy="136" r="16"/><circle class="r2" cx="99" cy="136" r="30"/><circle class="r3" cx="99" cy="136" r="44"/><path class="ridge" d="M85 142a14 14 0 0 1 28 0M89 150a10 10 0 0 1 20 0M93 156a6 6 0 0 1 12 0M99 118v6"/></g>
      <text class="cap" x="99" y="232" text-anchor="middle">fingerprint or face</text>
      <g class="msg"><rect x="176" y="112" width="82" height="48" rx="12"/><path d="M190 128h54M190 140h36"/><circle class="sig" cx="244" cy="148" r="6"/></g><path class="send" d="M262 136h50"/><path class="send" d="M304 128l10 8-10 8"/>
      <g class="wallet"><rect x="316" y="108" width="62" height="56" rx="12"/><path d="M316 126h62"/><circle cx="360" cy="146" r="5" class="wdot"/></g><text class="cap" x="347" y="190" text-anchor="middle">sent by anyone</text><g class="coin"><circle cx="347" cy="222" r="11"/><text x="347" y="226" text-anchor="middle">fee</text></g></svg>`
  };

  // ---------- icon cards: what LGtie does not do ----------
  const icons = {
    truth: '<svg viewBox="0 0 64 64"><circle cx="28" cy="28" r="14"/><path d="M38 38l14 14"/><path class="q" d="M24 24a4 4 0 1 1 5 4c-1 1-1 2-1 3M28 35v1"/></svg>',
    money: '<svg viewBox="0 0 64 64"><rect x="8" y="18" width="48" height="28" rx="6"/><circle cx="32" cy="32" r="7"/><path d="M15 27h2M47 37h2"/><path class="slash" d="M12 54L52 10"/></svg>',
    early: '<svg viewBox="0 0 64 64"><path d="M24 8h16M28 8v18L14 52a4 4 0 0 0 4 6h28a4 4 0 0 0 4-6L36 26V8"/><path class="liq" d="M20 44h24"/><circle class="bub b1" cx="30" cy="40" r="2"/><circle class="bub b2" cx="38" cy="36" r="2"/></svg>'
  };
  function notCards() {
    const c = [["truth", "It can't tell what is true", "If someone lies, the result follows the lie. A reviewer settles disputed facts, and can be wrong."], ["money", "It holds no money", "The contracts record decisions only. Another contract may read a verdict and pay."], ["early", "It is an early prototype", "Unaudited, with no customers yet. Recovery for a lost device is still being built."]];
    return `<div class="nocards">${c.map(([k, h, p]) => `<div class="nocard"><div class="nicon">${icons[k]}</div><h3>${h}</h3><p>${p}</p></div>`).join("")}</div>`;
  }
  window.TB_GFX = {flow, ill, notCards};
})();
