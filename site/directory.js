// The reviewer directory (docs/REVIEWER-DIRECTORY.md, Wave 1). A place to FIND a reviewer, built on evidence and never on scores:
//   * what a reviewer says about themselves (signed profile, shown as their own statement, with the date availability was last confirmed);
//   * what the chain shows about their work (counts with denominators; a percentage only after five different parties);
//   * conflict information: what they declared, and what the chain shows about their past cases with the people choosing them.
// A listing is a choice the reviewer signs. LGtie does not check or endorse anyone, takes no cut, and never touches the reviewer's fee: it is paid directly.
// The pure statistics work in Node (module.exports); the page needs the browser.
(function () {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const MIN_PARTIES_FOR_PERCENT = 5;
  const zero = a => !a || /^0x0*$/i.test(String(a));

  // ---------- pure: statistics from cases ----------
  /// A case, in one shape whatever contract it came from: {reviewer, status (0 answering, 1 awaiting the reviewer, 2 decided, 3 expired), hadDispute, acked, parties: [key], business: key|null}.
  /// A reviewer's work is counted only where the sides actually disagreed (hadDispute): where they agreed, nobody needed a reviewer.
  function computeStats(cases, addr) {
    const a = String(addr).toLowerCase(), mine = cases.filter(c => c.reviewer && String(c.reviewer).toLowerCase() === a);
    const asked = mine.filter(c => c.hadDispute), decided = asked.filter(c => c.status === 2).length, missed = asked.filter(c => c.status === 3).length, acked = asked.filter(c => c.acked).length;
    const active = mine.filter(c => c.status === 0 || c.status === 1).length, parties = new Set(), biz = new Map();
    mine.forEach(c => { (c.parties || []).forEach(k => parties.add(k)); if (c.business) biz.set(c.business, (biz.get(c.business) || 0) + 1); });
    const bizCases = [...biz.values()].reduce((x, y) => x + y, 0), top = [...biz.values()].sort((x, y) => y - x)[0] || 0;
    const enough = parties.size >= MIN_PARTIES_FOR_PERCENT;
    return {named: mine.length, asked: asked.length, decided, missed, acked, active, parties: parties.size, businesses: biz.size, topCount: top, bizCases, topShare: bizCases ? top / bizCases : 0,
      deadlinePct: enough && decided + missed ? Math.round(100 * decided / (decided + missed)) : null, acceptPct: enough && asked.length ? Math.round(100 * acked / asked.length) : null, enough};
  }
  /// How many cases this reviewer already had where one of these people was a party: shown when someone proposes them.
  const priorWith = (cases, addr, keys) => { const a = String(addr).toLowerCase(), want = new Set(keys); return cases.filter(c => c.reviewer && String(c.reviewer).toLowerCase() === a && (c.parties || []).some(k => want.has(k))).length; };
  const partyKey = p => (p && p.wallet && !zero(p.wallet)) ? String(p.wallet).toLowerCase() : (p && p.passkey && BigInt(p.passkey) !== 0n) ? "pk:" + p.passkey : null;
  /// From a wallet-era case (strings) and a passkey-era case ({wallet, passkey} sides).
  function fromWalletCase(c) { const parties = [c.filer, c.decider].filter(x => !zero(x)).map(x => x.toLowerCase()); return {reviewer: c.reviewer, status: c.status, hadDispute: c.disputed !== 0n, acked: false, parties, business: zero(c.decider) ? null : c.decider.toLowerCase()}; }
  function fromPasskeyCase(c) {
    const f = partyKey(c.filer), d = partyKey(c.decider), wallets = [f, d].filter(k => k && !k.startsWith("pk:"));
    return {reviewer: c.reviewer, status: c.status, hadDispute: c.disputed !== 0n, acked: !!c.reviewerAcked, parties: [f, d].filter(Boolean), business: wallets.length === 1 ? wallets[0] : null};
  }
  const api = {computeStats, priorWith, partyKey, fromWalletCase, fromPasskeyCase, MIN_PARTIES_FOR_PERCENT};
  if (isNode) { module.exports = api; return; }

  // ---------- the browser ----------
  const main = document.querySelector("#main"), $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const R = () => window.TB_RID, short = a => a.slice(0, 6) + "…" + a.slice(-4);

  let chainCache = null;
  /// Every case on every contract this site knows, in one shape. Read once per page load.
  function loadCases() {
    if (!chainCache) chainCache = (async () => {
      const out = [];
      try { const sc = await window.TB_CASES.scanCases(200); sc.cases.forEach(c => out.push(fromWalletCase(c))); } catch (e) {}
      try { const u = await window.TB_PASSKEYS.usage(); if (u) u.cases.forEach(c => out.push(fromPasskeyCase(c))); } catch (e) {}
      return out;
    })();
    return chainCache;
  }
  /// Profiles that reviewers listed on the public relays (each is a signed choice to be listed), newest per address. Resolves after a few seconds.
  function fetchListings({ms = 4500, relays} = {}) {
    return new Promise(resolve => {
      const best = new Map(); let done = false, stop = null, reached = false;
      const finish = () => { if (done) return; done = true; try { stop && stop(); } catch (e) {} resolve({list: [...best.values()].map(x => x.profile), reached}); };
      try {
        const N = window.TB_NOSTR; stop = N.listen(relays || N.relaysConfigured(), {kinds: [N.KIND], "#t": [R().DIRECTORY_TAG], limit: 300}, ev => {
          reached = true; try { const r = R().parse(JSON.parse(ev.content).code); if (r.ok && r.profile.listed) { const cur = best.get(r.profile.address); if (!cur || ev.created_at > cur.at) best.set(r.profile.address, {at: ev.created_at, profile: r.profile}); } } catch (e) {}
        }, st => { if (st && st.open > 0) reached = true; });
      } catch (e) {}
      setTimeout(finish, ms);
    });
  }

  // ---------- one listing ----------
  const pct = (n, of) => of ? `${n} of ${of}` : "0";
  function statsHtml(st) {
    if (st === undefined) return `<p class="small mute">Record from the chain: reading…</p>`;
    if (!st || !st.named) return `<p class="small mute">Record from the chain: no cases yet. That is not a mark against them, only that they have not been named on a case.</p>`;
    const lines = [`named on <b>${st.named}</b> case${st.named === 1 ? "" : "s"}`, `asked to decide <b>${st.asked}</b> (the sides disagreed)`, `decided <b>${st.decided}</b>`, `no decision in time <b>${st.missed}</b>`, `open now <b>${st.active}</b>`, `<b>${st.parties}</b> different part${st.parties === 1 ? "y" : "ies"}`];
    const pcs = st.enough ? [st.deadlinePct !== null ? `decided before the deadline in ${st.deadlinePct}% of ${st.decided + st.missed} (${pct(st.decided, st.decided + st.missed)})` : "", st.acceptPct !== null ? `acknowledged ${st.acceptPct}% of ${st.asked}` : ""].filter(Boolean).join(" · ")
      : `Percentages appear once there are ${MIN_PARTIES_FOR_PERCENT} different parties; with fewer they would mislead.`;
    const conc = st.bizCases ? `<br>Independence: the most frequent wallet party was in <b>${Math.round(100 * st.topShare)}%</b> of the ${st.bizCases} cases that have one (${st.topCount}), across <b>${st.businesses}</b> wallet part${st.businesses === 1 ? "y" : "ies"}. A high share is a reason to ask questions, not proof of bias.` : "";
    return `<p class="small"><b>Record from the chain</b> (read live, latest 200 cases per contract): ${lines.join(" · ")}.<br>${pcs}${conc}</p>`;
  }
  function listingHtml(p, st, mode) {
    const spec = p.specialty ? p.specialty.split(",").map(x => x.trim()).filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join(" ") : "";
    return `<div class="card dircard" data-addr="${p.address}"><p style="margin:0 0 4px;font-size:18px">${R().nameHtml(p)} <span class="badge warn">self-listed · not checked by LGtie</span></p>
      ${spec ? `<p class="small" style="margin:4px 0">${spec}${p.fee ? ` <span class="small">Fee: <b>${esc(p.fee)}</b></span>` : ""}</p>` : p.fee ? `<p class="small">Fee: <b>${esc(p.fee)}</b></p>` : ""}
      ${R().detailsHtml(p)}
      <p class="small">Disclosed relationships: <b>${esc(p.disclosure)}</b> <span class="mute">(their own statement; LGtie cannot check it)</span></p>
      <p class="small">Signed with <code>${short(p.address)}</code> · public page ${R().link(p.url)} · <a href="#reviewer/${p.address}">full record</a></p>
      ${statsHtml(st)}${mode === "pick" ? `<div class="row"><button class="btn small" data-choose="${p.address}" type="button">Choose this reviewer</button></div>` : ""}</div>`;
  }
  const availRank = p => { const a = R().availability(p); return a.state === "available" ? 0 : a.state === "none" || a.state === "stale" ? 1 : 2; };
  /// Filter by what people ask for; sort by availability then experience (decided cases), never by a rating.
  function arrange(list, stats, f) {
    return list.filter(p => (!f.text || (p.specialty + " " + p.name + " " + p.role + " " + p.regions).toLowerCase().includes(f.text.toLowerCase())) && (!f.avail || R().availability(p).state === "available") && (!f.arr || (p.arrangements || "").split(",").includes(f.arr)))
      .sort((x, y) => availRank(x) - availRank(y) || ((stats.get(y.address) || {}).decided || 0) - ((stats.get(x.address) || {}).decided || 0) || x.name.localeCompare(y.name));
  }
  const controls = () => `<div class="card"><div class="fgrid2"><label class="field"><span>Search specialties, names, regions</span><input id="dr-q" type="text" placeholder="For example: freelance, electronics"></label>
    <label class="field"><span>How the fee is paid</span><select id="dr-arr"><option value="">Any</option><option value="split">Split between the two sides</option><option value="sponsored">Paid by the business</option><option value="volunteer">Volunteer (free)</option></select></label></div>
    <label class="check"><input type="checkbox" id="dr-av"> <span>Only reviewers who say they are available (confirmed in the last 30 days)</span></label></div>`;

  // ---------- the page: #directory ----------
  async function page() {
    main.innerHTML = `<h1>Find a reviewer</h1><p class="lede">A reviewer is the neutral person both sides accept to decide only the questions they answered differently. Anyone can list themselves here. <b>Nobody is checked or endorsed by LGtie.</b> You and the other side both have to accept whoever you choose, and either of you can say no.</p>
      <div class="note"><b>Paying a reviewer.</b> A reviewer's fee is agreed and paid directly between you and them. LGtie takes no cut, never holds the money and cannot make anyone pay, so agree it first: split between the two sides, paid by the business, or free. Do not pay anyone before they confirm they will take the case.</div>
      ${controls()}<div id="dr-list"><p class="mute">Looking for listed reviewers on the public relays…</p></div>
      <p class="small mute">Want to be listed? Open your own address at <a href="#reviewer">Reviewers</a>, choose <i>This is my address: set up my profile</i> and tick the listing box. <a href="#reviewer">Activity record of every reviewer</a></p>`;
    const {list, reached} = await fetchListings(), stats = new Map();   // listings first; the chain record fills in when the cases have been read
    const f = {text: "", avail: false, arr: ""}, draw = () => {
      const shown = arrange(list, stats, f);
      $("#dr-list").innerHTML = shown.length ? shown.map(p => listingHtml(p, stats.get(p.address), "view")).join("") : `<div class="card"><p>${list.length ? "No listed reviewer matches. Loosen the filters." : reached ? "Nobody has listed themselves yet." : "Could not reach the public relays, so listings cannot be shown right now. Try again in a moment."}</p></div>`;
    };
    $("#dr-q").oninput = e => { f.text = e.target.value.trim(); draw(); }; $("#dr-av").onchange = e => { f.avail = e.target.checked; draw(); }; $("#dr-arr").onchange = e => { f.arr = e.target.value; draw(); }; draw();
    loadCases().then(cases => { list.forEach(p => stats.set(p.address, computeStats(cases, p.address))); if ($("#dr-list")) draw(); });
  }

  // ---------- the picker: a window other screens open to fill in a reviewer's address ----------
  async function pick(onPick) {
    const bg = document.createElement("div"); bg.className = "modalbg"; bg.setAttribute("role", "dialog"); bg.setAttribute("aria-label", "Choose a reviewer");
    bg.innerHTML = `<div class="modal"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Choose a reviewer</h2><button class="btn small ghost" data-close type="button">Close</button></div>
      <p class="small mute">Self-listed, not checked by LGtie. The reviewer's fee is paid directly between you and them. The other side still has to accept whoever you choose.</p>${controls()}<div id="dr-list"><p class="mute">Looking for listed reviewers…</p></div></div>`;
    document.body.appendChild(bg); const close = () => bg.remove(); bg.querySelector("[data-close]").onclick = close; bg.onclick = e => { if (e.target === bg) close(); };
    const onKey = e => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } }; document.addEventListener("keydown", onKey);
    const {list, reached} = await fetchListings(); if (!bg.isConnected) return;
    const stats = new Map(), f = {text: "", avail: false, arr: ""}, root = bg.querySelector(".modal");
    const draw = () => { const shown = arrange(list, stats, f), box = root.querySelector("#dr-list");
      box.innerHTML = shown.length ? shown.map(p => listingHtml(p, stats.get(p.address), "pick")).join("") : `<div class="card"><p>${list.length ? "No listed reviewer matches." : reached ? "Nobody has listed themselves yet." : "Could not reach the public relays."}</p></div>`;
      box.querySelectorAll("[data-choose]").forEach(b => b.onclick = () => { const p = list.find(x => x.address === b.dataset.choose); close(); onPick(p.address, p); }); };
    root.querySelector("#dr-q").oninput = e => { f.text = e.target.value.trim(); draw(); }; root.querySelector("#dr-av").onchange = e => { f.avail = e.target.checked; draw(); }; root.querySelector("#dr-arr").onchange = e => { f.arr = e.target.value; draw(); }; draw();
    loadCases().then(cases => { list.forEach(p => stats.set(p.address, computeStats(cases, p.address))); if (bg.isConnected) draw(); });
  }
  /// A "Choose from the directory" button next to a reviewer-address input.
  const pickButton = (inputSel, after) => `<button class="btn small ghost" type="button" data-dirpick="${esc(inputSel)}">Choose from the directory</button>`;
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-dirpick]"); if (!b) return; e.preventDefault(); pick((addr, p) => { const inp = document.querySelector(b.dataset.dirpick); if (inp) { inp.value = addr; inp.dispatchEvent(new Event("input", {bubbles: true})); inp.dispatchEvent(new Event("change", {bubbles: true})); } }); });
  /// For the screen where someone proposes a reviewer: what they said, and what the chain shows about this reviewer and the people involved.
  async function appointmentInfo(addr, partyKeys) {
    const [p, cases] = await Promise.all([R().lookup(addr), loadCases()]), prior = priorWith(cases, addr, partyKeys || []), st = computeStats(cases, addr);
    const conflict = prior ? `<p class="small"><span class="badge warn">chain shows ${prior} earlier case${prior === 1 ? "" : "s"}</span> where this reviewer was named and one of the two sides was a party. Ask whether that is a problem.</p>` : `<p class="small mute">The chain shows no earlier case where this reviewer was named and one of you was a party. That is not a complete conflict check.</p>`;
    return `<div class="card"><p class="small" style="margin:0 0 6px"><b>About <code>${short(addr)}</code></b></p>${p ? `<p style="margin:0 0 4px">${R().nameHtml(p)} ${p.listed ? `<span class="badge warn">self-listed · not checked by LGtie</span>` : `<span class="badge ok">identity signed by this wallet</span>`}</p>${p.fee ? `<p class="small">Fee: <b>${esc(p.fee)}</b></p>` : ""}${R().detailsHtml(p)}<p class="small">Disclosed relationships: <b>${esc(p.disclosure || "none stated")}</b> <span class="mute">(their own statement)</span></p>` : `<p class="small"><span class="badge warn">address only</span> No signed identity found.</p>`}${conflict}${statsHtml(st)}
      <p class="small mute"><b>Fee.</b> Agree who pays and how before the reviewer starts: split between you, paid by the business, or free. It is paid directly to them. LGtie cannot enforce it, and the reviewer should confirm they are taking the case before anyone pays.</p></div>`;
  }
  window.TB_DIRECTORY = {page, pick, pickButton, appointmentInfo, computeStats, priorWith, loadCases, fetchListings, partyKey};
})();
