// How LGtie earns revenue, on the page: the pricing page (#pricing), subscribing, and the small fee when a case is opened.
// Everything is paid in a 6-decimal dollar token straight to the treasury by the LGtieBilling contract, which never holds funds. Static: no server.
// The contract addresses come from TB_CONFIG.v6 (else v5): the newest billing contract is the one that charges; until they are deployed the page shows the planned prices and says nothing is charged yet.
(function () {
  "use strict";
  const K = window.TB_PK, CFG = window.TB_CONFIG, W = () => window.TB_WALLET, main = document.querySelector("#main"), $ = s => document.querySelector(s);
  const ZERO = "0x" + "0".repeat(40);
  const V5 = () => (CFG.v7 && CFG.v7.billing ? CFG.v7 : CFG.v6 && CFG.v6.billing ? CFG.v6 : CFG.v5) || {}, deployed = () => !!(V5().billing && V5().billing !== ZERO && V5().cases && V5().cases !== ZERO);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const short = a => a.slice(0, 6) + "…" + a.slice(-4);
  const enc = (name, types = [], vals = []) => K.hex(K.call(name, types, vals));
  const call = (to, data) => W().rpc("eth_call", [{to, data}, "latest"]);
  const words = h => { const x = h.replace(/^0x/, ""), out = []; for (let i = 0; i + 64 <= x.length; i += 64) out.push(BigInt("0x" + x.slice(i, i + 64))); return out; };
  const money = n => { const v = Number(n) / 1e6; return (Number.isInteger(v) ? String(v) : v.toFixed(2)) + " USDT"; };
  const when = sec => new Date(Number(sec) * 1000).toLocaleDateString([], {dateStyle: "medium"});
  // the prices shown before anything is deployed (the same numbers scripts/deploy-v5.sh deploys with)
  const PLANNED = {caseFee: 3000000n, plans: {1: {month: 29000000n, year: 290000000n, cases: 50n}, 2: {month: 99000000n, year: 990000000n, cases: 300n}}};
  const SEL_OPEN_SIGNED = K.keccak(K.utf8("openFromAgreementSigned(uint256,bytes32,bool," + K.typeStr(K.SIGAUTH) + ")")).slice(0, 10);

  async function info() {
    if (!deployed()) return {live: false, ...PLANNED};
    const B = V5().billing, one = async (n, t = [], v = []) => words(await call(B, enc(n, t, v)));
    const [[fee], p1, p2, [tr], [tok]] = await Promise.all([one("caseFee"), one("plans", ["uint8"], [1]), one("plans", ["uint8"], [2]), one("treasury"), one("token")]);
    return {live: true, caseFee: fee, plans: {1: {month: p1[0], year: p1[1], cases: p1[2]}, 2: {month: p2[0], year: p2[1], cases: p2[2]}}, treasury: "0x" + tr.toString(16).padStart(40, "0"), token: "0x" + tok.toString(16).padStart(40, "0")};
  }
  async function status(addr) {
    const w = words(await call(V5().billing, enc("statusOf", ["address"], [addr])));
    return {plan: Number(w[0]), expiry: Number(w[1]), active: w[2] === 1n, used: Number(w[3]), left: Number(w[4])};
  }
  const tokenOf = async () => "0x" + words(await call(V5().billing, enc("token")))[0].toString(16).padStart(40, "0");
  async function approveIfNeeded(amount, say) {
    const acct = await W().connect(), tok = await tokenOf(), B = V5().billing;
    const bal = words(await call(tok, enc("balanceOf", ["address"], [acct])))[0];
    if (bal < amount) throw new Error("You need " + money(amount) + " in this wallet to pay this. It holds " + money(bal) + ".");
    const al = words(await call(tok, enc("allowance", ["address", "address"], [acct, B])))[0];
    if (al >= amount) return false;
    if (say) say("Step 1 of 2: allow LGtie to take " + money(amount) + ". Confirm in your wallet…");
    await W().send(tok, enc("approve", ["address", "uint256"], [B, amount]));
    return true;
  }

  /// Before a case is opened by this wallet: if the business's subscription does not cover it, the per-case fee is paid by the opener, so
  /// make sure the wallet has allowed it. Returns what happened so the page can say so. Does nothing until the contracts are deployed.
  async function ensureFee(business, say) {
    if (!deployed()) return {fee: 0n, covered: true};
    const inf = await info();
    if (inf.caseFee === 0n) return {fee: 0n, covered: true};
    const s = await status(business);
    if (s.active && s.left > 0) return {fee: 0n, covered: true};
    if (say) say("Opening a case costs " + money(inf.caseFee) + ", paid to LGtie. Checking your wallet…");
    await approveIfNeeded(inf.caseFee, say);
    return {fee: inf.caseFee, covered: false};
  }
  /// For a signed action someone is about to submit: if it opens a case, make the fee payable first.
  async function before(o, say) {
    if (!deployed() || !o || !o.to || o.to.toLowerCase() !== V5().cases.toLowerCase() || !String(o.data).startsWith(SEL_OPEN_SIGNED)) return {fee: 0n, covered: true};
    const id = BigInt("0x" + String(o.data).slice(10, 74)), ag = V5().agreements || (CFG.v4 || {}).agreements;   // the registry the agreement lives in
    const business = "0x" + words(await call(ag, enc("get", ["uint256"], [id])))[0].toString(16).padStart(40, "0");   // the proposer's wallet is the first word
    return ensureFee(business, say);
  }
  /// A short line for pages that open cases.
  async function feeNote(business) {
    try {
      if (!deployed()) return "";
      const inf = await info(); if (inf.caseFee === 0n) return "";
      const s = await status(business);
      return s.active && s.left > 0 ? "Covered by the business's LGtie subscription: no case fee." : "Opening a case costs " + money(inf.caseFee) + ", paid to LGtie.";
    } catch { return ""; }
  }

  // ---------- the pricing page ----------
  async function page() {
    main.innerHTML = `<h1>Pricing</h1><p class="lede">LGtie charges a small fee when a case is opened, or a flat monthly plan for businesses with many. It never holds your money: every payment goes straight from you to LGtie's address in the same transaction, so there is nothing for LGtie to lose or to hold back.</p><p class="mute">Reading from X Layer…</p>`;
    let inf; try { inf = await info(); } catch { inf = {live: false, ...PLANNED}; }
    const p = inf.plans, fee = inf.caseFee;
    const card = (id, name, who, price, extra, items, buy) => `<div class="card price" id="${id}"><h3>${name}</h3><p class="small mute">${who}</p><p class="pv">${price}</p><p class="small mute">${extra}</p><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>${buy}</div>`;
    const buy = id => inf.live ? `<div class="row"><button class="btn" data-sub="${id}" data-y="0" type="button">Subscribe monthly</button><button class="btn ghost" data-sub="${id}" data-y="1" type="button">Subscribe yearly</button></div>` : `<p class="small mute">Not on sale yet.</p>`;
    main.innerHTML = `<h1>Pricing</h1>
      <p class="lede">LGtie charges a small fee when a case is opened, or a flat monthly plan for businesses with many. It never holds your money: every payment goes straight from you to LGtie's address in the same transaction, so there is nothing for LGtie to lose or to hold back.</p>
      ${inf.live ? "" : `<div class="note">Payments are built and tested but not deployed on X Layer yet. These are the planned prices, and nothing is charged today.</div>`}
      <div class="priceg">
        ${card("pl0", "Pay as you go", "Occasional disputes, freelancers, one-off buyers.", money(fee), "per case opened", ["No subscription, no commitment", "Paid by whoever opens the case, so a business that does not pay can never stop a customer from opening one", "Only when a case is opened: checking claims and reading cases is free"], "")}
        ${card("pl1", "Business", "A business with recurring claims or returns.", money(p[1].month), "per month, or " + money(p[1].year) + " per year", [Number(p[1].cases) + " cases a month under your agreements, with no case fee", "Covers cases your customers open as well", "Past the monthly allowance the case fee applies again"], buy(1))}
        ${card("pl2", "Pro", "Protocols, bounty programmes and larger businesses.", money(p[2].month), "per month, or " + money(p[2].year) + " per year", [Number(p[2].cases) + " cases a month, with no case fee", "Built for programmes with a steady flow of cases", "Everything in Business"], buy(2))}
      </div>
      <div class="card" id="mine"><h3>Your plan</h3><div id="minebody"><p class="small mute">${inf.live ? "Connect your wallet to see your plan." : "Plans open once the contracts are deployed."}</p></div>${inf.live ? `<div class="row"><button class="btn ghost" id="seeplan" type="button">Show my plan</button></div>` : ""}</div>
      <div class="card"><h3>How the money moves</h3><ul class="small">
        <li>You pay in USDT on X Layer. The only other cost is the tiny network fee.</li>
        <li>${inf.live ? `Every payment goes straight to <code>${esc(inf.treasury)}</code>.` : "Every payment goes straight to LGtie's address."} The billing contract never holds any money, and a test checks that after every kind of payment it holds exactly nothing.</li>
        <li>Prices can be changed, but never above caps written into the contract: at most 10 USDT per case, 500 per month and 5,000 per year. The reviewer's own fee, if any, is agreed and paid directly between the parties, and LGtie takes no cut of it.</li>
        <li>A plan does not renew by itself, because there is no server to charge you. Subscribe again before it ends; time is added on top. Switching to a higher plan starts it now and does not refund the rest of the old one.</li>
        <li>The contracts are unaudited. Everything recorded is public.</li>${(() => { const act = (V5().billing || "").toLowerCase(), old = [CFG.v6, CFG.v5].filter(c => c && c.billing && c.billing.toLowerCase() !== act).map(c => c.billing); return old.length && act ? `<li>New cases now open on a newer contract with its own billing. A plan bought earlier, on ${old.map(a => `<code>${short(a)}</code>`).join(" or ")}, does not cover them: subscribe again here.</li>` : ""; })()}</ul></div>`;
    const msg = (t, cls) => { const m = $("#minebody"); if (m) m.innerHTML = `<p class="small ${cls || "mute"}">${esc(t)}</p>`; };
    const showPlan = async () => {
      try {
        const acct = await W().connect(), s = await status(acct);
        $("#minebody").innerHTML = s.active
          ? `<p><span class="badge ok">${s.plan === 2 ? "Pro" : "Business"}</span> until <b>${when(s.expiry)}</b>.</p><p class="small">${s.used} used this month, <b>${s.left}</b> left. Wallet <code>${short(acct)}</code>.</p>`
          : `<p class="small">No active plan on <code>${short(acct)}</code>.${s.expiry ? " The last one ended " + when(s.expiry) + "." : ""} Cases you open pay the case fee.</p>`;
      } catch (e) { msg((e && e.message) || String(e), "err"); }
    };
    if ($("#seeplan")) $("#seeplan").onclick = showPlan;
    document.querySelectorAll("[data-sub]").forEach(b => b.onclick = async () => {
      const plan = Number(b.dataset.sub), yearly = b.dataset.y === "1", price = yearly ? p[plan].year : p[plan].month;
      document.querySelectorAll("[data-sub]").forEach(x => x.disabled = true);
      try {
        msg("Checking your wallet…");
        await approveIfNeeded(price, t => msg(t));
        msg("Step 2 of 2: pay " + money(price) + " for " + (plan === 2 ? "Pro" : "Business") + ", " + (yearly ? "one year" : "one month") + ". Confirm in your wallet…");
        const rc = await W().send(V5().billing, enc("subscribe", ["uint8", "bool"], [plan, yearly]));
        await showPlan();
        $("#minebody").insertAdjacentHTML("beforeend", `<p class="small ok">✓ Paid. <a href="${CFG.explorer}/tx/${rc.transactionHash}" target="_blank" rel="noopener">${rc.transactionHash.slice(0, 12)}…</a></p>`);
      } catch (e) { msg((e && e.message) || String(e), "err"); }
      document.querySelectorAll("[data-sub]").forEach(x => x.disabled = false);
    });
  }

  window.TB_BILLING = {page, info, status, ensureFee, before, feeNote, deployed, money};
})();
