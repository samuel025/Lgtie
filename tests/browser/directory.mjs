// The reviewer directory (docs/REVIEWER-DIRECTORY.md, Wave 1): a reviewer lists themselves with the new profile form, listings are found on a relay, nobody can be listed
// against their will, stale availability is marked, filters work, the picker fills a reviewer's address in three places, and the chain statistics read real cases.
// Needs the site on http://localhost:8090, puppeteer-core with `ws`, and `cast`. Reads X Layer (case #1) for the statistics check.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { startRelay } from "./nostr-relay.mjs";
const SITE = process.env.SITE || "/home/samuel/Documents/tiebreak", require = createRequire(import.meta.url), R = require(SITE + "/site/reviewerid.js"), N = require(SITE + "/site/nostr.js");
const BASE = process.env.BASE || "http://localhost:8090/index.html", CAST = process.env.CAST || (process.env.HOME + "/.foundry/bin/cast");
const KEYS = {amina: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", bola: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdd1c60a", chidi: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"};
const ADDR = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, execFileSync(CAST, ["wallet", "address", "--private-key", v], {encoding: "utf8"}).trim().toLowerCase()]));
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const relay = startRelay(8097), RELAYS = ["ws://127.0.0.1:8097"];
const signed = (who, fields) => { const text = R.statement({...fields, address: ADDR[who]}); return {...fields, address: ADDR[who], sig: execFileSync(CAST, ["wallet", "sign", "--private-key", KEYS[who], text], {encoding: "utf8"}).trim()}; };
// An event for a profile code, with whatever tags we choose (so we can try to list someone who did not opt in).
async function publishCode(code, address, tags) {
  const sk = crypto.getRandomValues(new Uint8Array(32)), ev = {pubkey: N.pubkeyOf(sk), created_at: Math.floor(Date.now() / 1000), kind: N.KIND, tags: [["d", "rid-" + address], ["t", "lgtie"], ["t", R.tagOf(address)], ...tags.map(t => ["t", t])], content: JSON.stringify({code})};
  ev.id = await N.idOf(ev); ev.sig = await N.sign(N.unhex(ev.id), sk);
  await new Promise(res => { const ws = new WebSocket(RELAYS[0]); ws.onopen = () => ws.send(JSON.stringify(["EVENT", ev])); ws.onmessage = () => { ws.close(); res(); }; setTimeout(res, 3000); });
}
const DIS = "Independent. No employment, financial or personal tie to either party.", old = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
const BOLA = signed("bola", {name: "Bola Adeyemi", role: "repair technician", url: "https://reviewer.example/bola", disclosure: DIS, specialty: "Electronics repair, warranty", fee: "15 USDT per case", arrangements: "sponsored", avail: "yes", confirmed: old, max: "3", listed: true});
const CHIDI = signed("chidi", {name: "Chidi Okafor", role: "moderator", url: "https://reviewer.example/chidi", disclosure: DIS, specialty: "Marketplace disputes", listed: false});
const AMINA_TAMPERED = {...signed("amina", {name: "Amina Yusuf", role: "assessor", url: "https://reviewer.example/amina", disclosure: DIS, listed: true}), fee: "1 USDT per case"};   // a changed field after signing
await publishCode(R.makeCode(BOLA), ADDR.bola, [R.DIRECTORY_TAG]);
await publishCode(R.makeCode(CHIDI), ADDR.chidi, []);                                  // did not opt in
await publishCode(R.makeCode(CHIDI), ADDR.chidi, [R.DIRECTORY_TAG]);                   // someone republishes it with the directory tag: still not listed
await publishCode(R.makeCode({...AMINA_TAMPERED, sig: AMINA_TAMPERED.sig}), ADDR.amina, [R.DIRECTORY_TAG]);   // a broken signature

const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]});
async function newPage(account, key) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1600}); const errs = []; p.on("pageerror", e => errs.push(e.message)); p.errs = errs;
  await p.exposeFunction("castSign", hex => execFileSync(CAST, ["wallet", "sign", "--private-key", key || KEYS.amina, hex], {encoding: "utf8"}).trim());
  await p.evaluateOnNewDocument((acct, relays) => { localStorage.setItem("lgtie.inboxRelays", JSON.stringify(relays)); localStorage.setItem("lgtie.lang", "en");
    window.ethereum = {request: async ({method, params}) => { if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct]; if (method === "eth_chainId") return "0xc4"; if (method === "personal_sign") return window.castSign(params[0]); throw new Error("unsupported " + method); }}; }, account, RELAYS);
  return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(250); } return false; };
const names = p => p.$$eval("#dr-list .dircard", cs => cs.map(c => c.innerText.split("\n")[0].replace(/\s+self-listed.*$/, "").trim()));

// ---- 1. Amina lists herself with the new profile form
const a = await newPage(ADDR.amina);
await a.goto(BASE + "#reviewer/" + ADDR.amina); await a.waitForSelector("#rid-me", {timeout: 30000}); await a.click("#rid-me"); await a.waitForSelector("#rid-sign");
ok("the profile form offers the directory fields", !!(await a.$("#rid-arr")) && !!(await a.$("#rid-av")) && !!(await a.$("#rid-max")) && !!(await a.$("#rid-resp")) && !!(await a.$("#rid-reg")) && !!(await a.$("#rid-list")));
ok("the form says payment is direct and LGtie never holds or takes it", /LGtie never holds or takes any of it/.test(await T(a, "#rid-setup")));
await a.type("#rid-name", "Amina Yusuf"); await a.type("#rid-role", "independent assessor"); await a.type("#rid-spec", "Freelance work, software"); await a.type("#rid-fee", "20 USDT per case");
await a.$eval('#rid-arr input[value="split"]', e => e.click()); await a.$eval('#rid-arr input[value="volunteer"]', e => e.click());
await a.type("#rid-reg", "West Africa"); await a.select("#rid-av", "yes"); await a.type("#rid-max", "5"); await a.type("#rid-resp", "within 24 hours"); await a.type("#rid-url", "https://reviewer.example/amina");
await a.$eval("#rid-list", e => e.click()); await a.click("#rid-sign");
ok("listing without a disclosure is refused with a plain reason", await until(async () => /relationship/.test(await T(a, "#rid-m2"))), await T(a, "#rid-m2"));
await a.type("#rid-dis", DIS); await a.click("#rid-sign");
ok("signing gives a code that carries the directory fields", await until(async () => /^lgtie-reviewer1\./.test(await a.$eval("#rid-code", e => e.value).catch(() => ""))), await T(a, "#rid-m2"));
const parsed = R.parse(await a.$eval("#rid-code", e => e.value));
ok("the signed profile has her arrangements, availability dated today, maximum, response and the listing choice", parsed.ok && parsed.profile.listed && parsed.profile.arrangements === "split,volunteer" && parsed.profile.avail === "yes" && parsed.profile.confirmed === R.today() && parsed.profile.max === "5" && parsed.profile.response === "within 24 hours", JSON.stringify(parsed));
await a.click("#rid-pub");
ok("publishing reaches the relay", await until(async () => /Published to 1 relay/.test(await T(a, "#rid-m3"))), await T(a, "#rid-m3"));
ok("the published event carries the directory tag because she chose to be listed", relay.events.some(e => e.tags.some(t => t[1] === R.DIRECTORY_TAG) && JSON.parse(e.content).code === R.makeCode(parsed.profile)));

// ---- 2. the directory
const d = await newPage(ADDR.chidi, KEYS.chidi); await d.goto(BASE + "#directory");
ok("the page explains that nobody is checked or endorsed and that payment is direct, with no cut", await until(async () => /Nobody is checked or endorsed by LGtie/.test(await T(d, "main")) && /takes no cut/.test(await T(d, "main")) && /Do not pay anyone before they confirm/.test(await T(d, "main"))), await T(d, "main"));
ok("it lists the two reviewers who opted in, the available one first", await until(async () => (await names(d)).length === 2), JSON.stringify(await names(d)));
ok("Amina (available today) comes before Bola (availability confirmed 60 days ago)", (await names(d)).join("|") === "Amina Yusuf, independent assessor|Bola Adeyemi, repair technician", JSON.stringify(await names(d)));
ok("someone who did not opt in is not listed, even when their profile is republished with the directory tag", !/Chidi/.test(await T(d, "#dr-list")));
ok("a profile whose signature was broken is not listed", (await T(d, "#dr-list")).split("Amina").length === 2 && !/1 USDT per case/.test(await T(d, "#dr-list")));
await until(async () => !/reading…/.test(await T(d, "#dr-list")), 60000);   // the chain record fills in after the listings
const list = await T(d, "#dr-list");
ok("every listing says it is self-listed and not checked by LGtie", (list.match(/self-listed · not checked by LGtie/g) || []).length === 2);
ok("Amina shows as available with the date, her fee arrangements and her own statements labelled as such", /available/.test(list) && new RegExp("confirmed " + R.today()).test(list) && /split between the two sides; volunteer, free/.test(list) && /the reviewer's own statement, not checked by LGtie/.test(list));
ok("Bola's stale availability is shown as not confirmed recently, not as removal", /availability not confirmed recently/.test(list) && new RegExp("last said available on " + old).test(list));
ok("each listing shows the relationships the reviewer disclosed, as their own statement", (list.match(/Disclosed relationships/g) || []).length === 2 && /their own statement/.test(list));
ok("the chain record is shown with counts, and says percentages wait for five different parties", /Record from the chain/.test(list) && /no cases yet/.test(list));
ok("there is no star rating, score or ranking by rating anywhere", !/★|stars?\b|rating|score/i.test(list), list.slice(0, 300));

// ---- 3. filters
await d.type("#dr-q", "electronics");
ok("searching specialties finds only the matching reviewer", await until(async () => (await names(d)).length === 1 && /Bola/.test((await names(d))[0])), JSON.stringify(await names(d)));
await d.$eval("#dr-q", e => { e.value = ""; e.dispatchEvent(new Event("input")); });
await d.$eval("#dr-av", e => e.click());
ok("'only available' hides a reviewer whose availability is stale", await until(async () => (await names(d)).length === 1 && /Amina/.test((await names(d))[0])), JSON.stringify(await names(d)));
await d.$eval("#dr-av", e => e.click()); await d.select("#dr-arr", "sponsored");
ok("filtering by who pays finds the business-sponsored reviewer", await until(async () => (await names(d)).length === 1 && /Bola/.test((await names(d))[0])), JSON.stringify(await names(d)));
await d.select("#dr-arr", "volunteer");
ok("and the volunteer one", await until(async () => (await names(d)).length === 1 && /Amina/.test((await names(d))[0])), JSON.stringify(await names(d)));
await d.type("#dr-q", "zzz");
ok("a search with no match says so", await until(async () => /No listed reviewer matches/.test(await T(d, "#dr-list"))));

// ---- 4. the chain statistics read real cases (case #1 on X Layer was decided by a reviewer)
const real = await d.evaluate(async () => { const cs = await window.TB_DIRECTORY.loadCases(), done = cs.filter(c => c.status === 2 && c.hadDispute); return {total: cs.length, decided: done.length, reviewer: done[0] && done[0].reviewer}; });
ok("the directory reads real cases from X Layer and finds a case a reviewer decided", real.total >= 1 && real.decided >= 1, JSON.stringify(real));
const st = await d.evaluate(async r => window.TB_DIRECTORY.computeStats(await window.TB_DIRECTORY.loadCases(), r), real.reviewer);
ok("that reviewer's record counts it, and shows no percentage from so few parties", st.decided >= 1 && st.asked >= 1 && st.enough === false && st.deadlinePct === null, JSON.stringify(st));

// ---- 5. the picker fills in a reviewer's address where one is named
const dl = await newPage(ADDR.chidi, KEYS.chidi); await dl.goto(BASE + "#deal/warranty"); await dl.waitForSelector("#dl-v", {timeout: 30000});
await dl.$eval('[data-dirpick="#dl-v"]', e => e.click());
ok("on the deal-link page 'Choose from the directory' opens the listed reviewers", await until(async () => (await dl.$$(".modal .dircard")).length === 2), await T(dl, "body"));
ok("the picker repeats that nobody is checked and the other side must accept", /Self-listed, not checked by LGtie/.test(await T(dl, ".modal")) && /The other side still has to accept/.test(await T(dl, ".modal")));
await dl.keyboard.press("Escape");
ok("Escape closes it without choosing", await until(async () => !(await dl.$(".modal"))) && (await dl.$eval("#dl-v", e => e.value)) === "");
await dl.$eval('[data-dirpick="#dl-v"]', e => e.click()); await dl.waitForSelector(".modal .dircard"); await dl.$eval(`[data-choose="${ADDR.bola}"]`, e => e.click());
ok("choosing a reviewer fills their address in and closes the window", await until(async () => !(await dl.$(".modal"))) && (await dl.$eval("#dl-v", e => e.value)).toLowerCase() === ADDR.bola);
if (await dl.$("#dl-card") && await dl.$eval("#dl-card", e => e.checked)) await dl.$eval("#dl-card", e => e.click());   // an ordinary link: signed cards would first ask for a passkey
await until(async () => !!(await dl.$("#dl-msg")));
const link = (await dl.$eval("#dl-msg", e => e.value).catch(() => "")).split("\n").pop(), payload = link.includes("#") ? JSON.parse(Buffer.from(link.split("#")[1], "base64url").toString()) : {};
ok("and it goes into the deal link as the named reviewer", (payload.v || "").toLowerCase() === ADDR.bola, link);
const inv = await newPage(ADDR.chidi, KEYS.chidi); await inv.goto(BASE + "#pk/agree"); await inv.waitForSelector("#rv", {timeout: 30000});
await inv.$eval('[data-dirpick="#rv"]', e => e.click()); await inv.waitForSelector(`.modal [data-choose="${ADDR.amina}"]`); await inv.$eval(`[data-choose="${ADDR.amina}"]`, e => e.click());
ok("on the invite page it fills the reviewer's address", await until(async () => (await inv.$eval("#rv", e => e.value)).toLowerCase() === ADDR.amina));

// ---- 6. links to it, and the old reviewers page
const rv = await newPage(ADDR.chidi, KEYS.chidi); await rv.goto(BASE + "#reviewer");
ok("the reviewers activity page links to the directory", await until(async () => !!(await rv.$('a[href="#directory"]'))));
const errs = [...a.errs, ...d.errs, ...dl.errs, ...inv.errs, ...rv.errs]; ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); await relay.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
