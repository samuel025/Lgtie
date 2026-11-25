// Standing agreements: an agreement page says it stays in force for any number of cases, and lists the cases opened under it with a count and their outcomes.
// Reads the real wallet agreement #1 and passkey agreement #1 from X Layer mainnet (read-only). Needs the site on http://localhost:8090 and puppeteer-core.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
async function page(lang) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(lang + ": " + e.message));
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 50000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(300); } return false; };

const e = await page("en");
await e.goto(BASE + "#agreement/1");
ok("an agreement in force says it is a standing agreement", await until(async () => /A standing agreement\./.test(await T(e, "main")) && /as many cases under it as you need/.test(await T(e, "main")) && /do not need a new agreement for every claim/.test(await T(e, "main"))), (await T(e, "main")).slice(0, 300));
ok("the cases under it are listed with a count", await until(async () => /Cases under this agreement/.test(await T(e, "#agcases")) && /\d+ cases?/.test(await T(e, "#agcases")) && (await e.$$("#agcases .agc li")).length >= 1), await T(e, "#agcases"));
ok("with how many are decided, open or ended with no decision", /\d+ (decided|open|no decision)/.test(await T(e, "#agcases")), await T(e, "#agcases"));
ok("the real case #1 is in the list, decided, with its result", /Case #1/.test(await T(e, "#agcases")) && /Decided/.test(await T(e, "#agcases")) && /Covered/.test(await T(e, "#agcases")), await T(e, "#agcases"));
ok("each case links to its page", await e.$$eval("#agcases .agc a", as => as.length >= 1 && as.every(a => /^#case\/\d+$/.test(a.getAttribute("href")))));
ok("the count matches the list", await e.$eval("#agcases", c => { const m = /(\d+) cases?/.exec(c.querySelector("h3").innerText); return !!m && Number(m[1]) === c.querySelectorAll(".agc li").length; }));

// the action buttons must not jump when the cards below them load (a click aimed at Accept once landed on a footer link)
await e.goto(BASE + "#agreement/1"); await w(1200);
const top0 = await e.$eval("#acts", x => Math.round(x.getBoundingClientRect().top + scrollY));
await until(async () => (await e.$$("#agcases .agc li")).length >= 1 && /Dispute process\./.test(await e.$eval("#clausecard textarea", t => t.value).catch(() => "")));
const top1 = await e.$eval("#acts", x => Math.round(x.getBoundingClientRect().top + scrollY));
ok("the action buttons sit above the case list and the clause", await e.evaluate(() => { const a = document.querySelector("#acts").getBoundingClientRect().top, c = document.querySelector("#agcases").getBoundingClientRect().top, k = document.querySelector("#clausecard").getBoundingClientRect().top; return a < c && a < k; }));
ok("and do not move while those cards load", Math.abs(top1 - top0) <= 2, top0 + " -> " + top1);

await e.goto(BASE + "#pk/agreement/1");
ok("the passkey agreement page says the same", await until(async () => /A standing agreement\./.test(await T(e, "main"))), (await T(e, "main")).slice(0, 200));
ok("and lists its cases with a count and outcomes", await until(async () => (await e.$$("#cases .agc li")).length >= 1 && /\d+ cases?/.test(await T(e, "#cases"))), await T(e, "#cases"));
ok("several cases can sit under one agreement (agreement #1 has more than one)", (await e.$$("#cases .agc li")).length >= 2, String((await e.$$("#cases .agc li")).length));
ok("each links to its passkey case page", await e.$$eval("#cases .agc a", as => as.every(a => /^#pk\/case\/\d+$/.test(a.getAttribute("href")))));
ok("the count matches the list here too", await e.$eval("#cases", c => { const m = /(\d+) cases?/.exec(c.querySelector("h3").innerText); return !!m && Number(m[1]) === c.querySelectorAll(".agc li").length; }));

const z = await page("zh");
await z.goto(BASE + "#agreement/1");
ok("in Chinese: the standing-agreement note and the case list are translated", await until(async () => /常设协议/.test(await T(z, "main")) && /这份协议下的案件/.test(await T(z, "#agcases")) && /\d+ 个案件/.test(await T(z, "#agcases")) && /已裁决/.test(await T(z, "#agcases"))), await T(z, "#agcases"));
ok("and the Chinese note says no new agreement is needed for every claim", /每一次索赔都不需要重新订立协议/.test(await T(z, "main")));
await z.goto(BASE + "#pk/agreement/1");
ok("in Chinese the passkey page too", await until(async () => /这份协议下的案件/.test(await T(z, "#cases")) && /个案件/.test(await T(z, "#cases"))), await T(z, "#cases"));

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
