// The rule check in the builder: built-in templates are clean, a bad question is flagged with advice, a suggested piece of evidence can be added with one click,
// "Show" takes you to the problem, publishing is never blocked, and it all works in Chinese. Nothing is sent anywhere. Needs the site on http://localhost:8090.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
async function page(lang) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(lang + ": " + e.message));
  const reqs = []; p.on("request", r => { if (!r.url().startsWith("http://localhost:8090") && !r.url().startsWith("data:")) reqs.push(r.url()); }); p.reqs = reqs;
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(200); } return false; };
const setVal = (p, sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); }, v);
const card = (p, step) => T(p, `#out .lint[data-s="${step}"]`);

const e = await page("en");
await e.goto(BASE + "#build/freelance"); await w(1500);
ok("a built-in template shows a Rule check with nothing to fix", await until(async () => /Rule check/.test(await card(e, 1))) && !/to fix/.test(await card(e, 1)), await card(e, 1));
ok("it says it runs in the browser, only warns, and never blocks", /nothing is sent anywhere/.test(await card(e, 1)) && /never stops you publishing/.test(await card(e, 1)));

// break the first question: a judgement word, no evidence
await setVal(e, '[data-qi="0"] [data-f="qt"]', "Was the work done properly?"); await setVal(e, '[data-qi="0"] [data-f="qh"]', ""); await w(700);
ok("a judgement word with no evidence is shown as something to fix", await until(async () => /to fix/.test(await card(e, 1)) && /Judgement word: "properly"/.test(await card(e, 1))), await card(e, 1));
ok("and it says the evidence is missing", /No evidence listed/.test(await card(e, 1)));
ok("the problem names its question", /Q1/.test(await card(e, 1)));

// a question where a suggestion exists, then use it
await setVal(e, '[data-qi="0"] [data-f="qt"]', "Does the build run without errors?"); await w(700);
ok("a missing piece of evidence comes with a suggestion", await until(async () => /Use this evidence/.test(await card(e, 1)) && /A short video or a test log showing it working/.test(await card(e, 1))), await card(e, 1));
await e.click("#out .lint[data-s=\"1\"] [data-lfix]"); await w(900);
ok("one click puts the suggested evidence in the question", await e.$eval('[data-qi="0"] [data-f="qh"]', i => i.value) === "A short video or a test log showing it working");
ok("and the warning goes away", !(await until(async () => /No evidence listed/.test(await card(e, 1)), 1500)));

// "Show" jumps to the problem
await setVal(e, '[data-qi="2"] [data-f="qt"]', "Is the code of high quality?"); await setVal(e, '[data-qi="2"] [data-f="qh"]', ""); await w(700);
await e.evaluate(() => scrollTo(0, 0));
await e.$$eval('#out .lint[data-s="1"] [data-lshow="2"]', bs => bs[0] && bs[0].click()); await w(600);
ok("Show takes you to the question and focuses it", await e.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-f") === "qt" && document.activeElement.closest("[data-qi]").getAttribute("data-qi") === "2"));

// rules: a rule that can never fire and a rule with no reason (step 2)
await e.click('[data-step-btn="2"]'); await w(500);
ok("the rules step has its own Rule check card", /Rule check/.test(await card(e, 2)));
await e.$$eval('[data-a="ruleadd"]', bs => bs[0].click()); await w(500);
await e.$$eval(".rrow[data-ui]", rows => rows[rows.length - 1].querySelector('[data-a="cell"]').click()); await w(700);
ok("a new rule with a condition but no reason is flagged", await until(async () => /no reason/.test(await card(e, 2)) || /没有写原因/.test(await card(e, 2))), await card(e, 2));

// the publish step shows a summary and never blocks
await e.click('[data-step-btn="4"]'); await w(700);
ok("the publish step shows the Rule check summary", /Rule check:/.test(await T(e, '[data-s="4"].card')) && /to (fix|consider)/.test(await T(e, '[data-s="4"].card')), await T(e, '[data-s="4"].card'));
ok("and the publish button is still there and enabled, so nothing is blocked", await e.$eval("#pubgo", x => !x.disabled).catch(() => false));
ok("Review them goes back to the questions", await (async () => { await e.$$eval("[data-lgo]", bs => bs[0].click()); await w(500); return (await e.$eval("#stepper .on .sn", s => s.textContent)) === "1"; })());
ok("nothing was sent to any other website", e.reqs.length === 0, e.reqs.join(","));

// ---- Chinese ----
const z = await page("zh");
await z.goto(BASE + "#build/secondhand"); await w(1500);
ok("in Chinese the Rule check card is in Chinese", await until(async () => /规则检查/.test(await card(z, 1))) && /没有发现问题|项可考虑/.test(await card(z, 1)), await card(z, 1));
await setVal(z, '[data-qi="0"] [data-f="qt"]', "物品是否被妥善保管？"); await setVal(z, '[data-qi="0"] [data-f="qh"]', ""); await w(800);
ok("a Chinese judgement word is caught, with Chinese advice", await until(async () => /项需处理/.test(await card(z, 1)) && /主观用词：“妥善”/.test(await card(z, 1))), await card(z, 1));
ok("and its buttons are in Chinese", /查看/.test(await card(z, 1)));
await setVal(z, '[data-qi="0"] [data-f="qt"]', "钥匙是否已归还？"); await w(800);
ok("a Chinese suggestion for the evidence can be used", await until(async () => /采用这条证据/.test(await card(z, 1)) && /交接消息或收据/.test(await card(z, 1))), await card(z, 1));
await z.click('#out .lint[data-s="1"] [data-lfix]'); await w(900);
ok("and it fills in the Chinese evidence", await z.$eval('[data-qi="0"] [data-f="qh"]', i => i.value) === "交接消息或收据");

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
