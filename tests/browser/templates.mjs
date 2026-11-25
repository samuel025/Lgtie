// Templates: the #templates page, a free checker for each template, opening one in the builder, and the same in Chinese.
// Needs the site on http://localhost:8090 and puppeteer-core. Reads nothing from the chain for the unpublished templates.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]});
const errs = [];
async function page(lang) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(lang + ": " + e.message));
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(250); } return false; };
const answer = async (p, i, v) => { const g = (await p.$$(".yn"))[i], btn = await g.$(`button[data-v="${v}"]`); await btn.evaluate(e => e.scrollIntoView({block: "center"})); await w(150); await btn.click(); };

// ---- English ----
const e = await page("en");
await e.goto(BASE + "#templates"); await w(1200);
ok("the page lists the five templates", (await e.$$eval(".tpl h3", hs => hs.map(h => h.textContent))).join("|") === "Second-hand sale|Freelance milestone|Rental deposit|Bug bounty severity|Warranty claim", (await e.$$eval(".tpl h3", hs => hs.map(h => h.textContent))).join("|"));
ok("each card offers the checker, the builder and a message to send", (await e.$$(".tpl")).length === 5 && (await e.$$('.tpl a[href^="#check/"]')).length === 5 && (await e.$$('.tpl a[href^="#build/"]')).length === 5 && (await e.$$("[data-msg]")).length === 5);
ok("only the warranty rules say they are published on X Layer", (await e.$$eval(".tpl", cs => cs.filter(c => /Published on X Layer/.test(c.innerText)).length)) === 1);
ok("it says plainly that trying a checker is free and that publishing costs a fee", /free and needs no wallet/.test(await T(e, "main")) && /small fee/.test(await T(e, "main")));
ok("it carries the 'ask for an LGtie agreement' advice for buyers and sellers", /Will you accept an LGtie agreement\?/.test(await T(e, "main")) && /supporting evidence/.test(await T(e, "main")) && !/proves|guarantee/i.test(await T(e, "main")));

// layout: a tidy list, one line of actions, a clause that fits
ok("on a desktop each template is one row with its actions on a single line", await e.$$eval(".tpl", rows => rows.every(r => { const a = r.querySelector(".acts").getBoundingClientRect(), x = r.getBoundingClientRect(); return a.height < 46 && a.right <= x.right && x.height < 130; })));
ok("the rows are the same width and line up", await e.$$eval(".tpl", rows => new Set(rows.map(r => Math.round(r.getBoundingClientRect().width))).size === 1 && new Set(rows.map(r => Math.round(r.getBoundingClientRect().left))).size === 1));
ok("every template has an icon", (await e.$$(".tpl .ico svg")).length === 5);
ok("the clause box grows to fit its text (no inner scrollbar)", await e.$eval("#clausecard textarea", t => t.scrollHeight <= t.clientHeight + 4));
ok("the controls sit beside the clause on a desktop", await e.$eval("#clausecard .ctl", c => { const d = document.querySelector("#clausecard .doc").getBoundingClientRect(), k = c.getBoundingClientRect(); return k.right <= d.left + 2 && Math.abs(k.top - d.top) < 80; }));
ok("the selects show their whole label (nothing cut off)", await e.$$eval("#clausecard select", ss => ss.every(s => { const o = s.options[s.selectedIndex].text; return o.length < 30 || s.clientWidth > 230; })));
const ph = await b.newPage(); await ph.setViewport({width: 390, height: 800, isMobile: true, deviceScaleFactor: 2}); ph.on("pageerror", x => errs.push("phone: " + x.message));
await ph.evaluateOnNewDocument(() => { try { localStorage.setItem("lgtie.lang", "en"); } catch (x) {} });
await ph.goto(BASE + "#templates"); await w(1800);
ok("on a phone the page does not scroll sideways", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
ok("and the rows stack with their actions underneath", await ph.$$eval(".tpl", rows => rows.every(r => { const a = r.querySelector(".acts").getBoundingClientRect(), t = r.querySelector(".txt").getBoundingClientRect(); return a.top >= t.bottom - 2 && a.right <= innerWidth; })));
ok("and the clause controls stack above the clause", await ph.$eval("#clausecard .ctl", c => { const d = document.querySelector("#clausecard .doc").getBoundingClientRect(); return c.getBoundingClientRect().bottom <= d.top + 2; }));
await ph.close(); await e.bringToFront();

await e.goto(BASE + "#check/secondhand"); await w(1500);
ok("the second-hand checker opens with its five questions", (await e.$$(".yn")).length === 5 && /Does the item match the description/.test(await T(e, "main")));
for (let i = 0; i < 5; i++) await answer(e, i, 1);
ok("all yes: no refund (nothing is wrong with the item)", await until(async () => /No refund/.test(await T(e, "main")) && /matches the listing, works/.test(await T(e, "main"))), (await T(e, "main")).slice(-300));
ok("and it says the result is computed in the browser, not published", await until(async () => /Preview: computed in your browser/.test(await T(e, "main"))), (await T(e, "main")).slice(-200));
await answer(e, 2, 0);
ok("a blocked IMEI: full refund, with the reason", await until(async () => /Full refund/.test(await T(e, "main")) && /blocked, locked or reported lost/.test(await T(e, "main"))), (await T(e, "main")).slice(-300));
await answer(e, 3, 0);
ok("reported too late: no refund, even though the IMEI is blocked (first rule wins)", await until(async () => /not reported within 48 hours/.test(await T(e, "main"))), (await T(e, "main")).slice(-300));

await e.goto(BASE + "#build/rental"); await w(1500);
ok("the builder opens on the rental template", await e.$eval('input[value*="keys and access cards"]', x => !!x).catch(() => false) || (await e.$$eval("input", is => is.some(i => /keys and access cards/.test(i.value)))));
ok("it has a button for every template and a blank one", (await e.$$("[data-t]")).length === 6, String((await e.$$("[data-t]")).length));
await e.click('[data-t="freelance"]'); await w(800);
ok("choosing another template loads it", (await e.$$eval("input", is => is.some(i => /delivered by the agreed deadline/.test(i.value)))));

// ---- the clause for a written contract ----
const val = (p, sel) => p.$eval(sel, e => e.value).catch(() => "");
await e.goto(BASE + "#templates"); await w(1500);
const CL = "#clausecard textarea";
ok("the templates page has a clause for your written contract", await until(async () => /Dispute process\./.test(await val(e, CL))), await val(e, CL));
ok("it says the legal effect comes from your own contract and asks for a lawyer's review", /legal effect comes from your own written contract/.test(await T(e, "#clausecard")) && /lawyer in your jurisdiction/.test(await T(e, "#clausecard")));
ok("it says the record is public and is not a judgment or an award", /public on the blockchain/.test(await T(e, "#clausecard")) && /not a court judgment or an arbitral award/.test(await val(e, CL)));
const binding = await val(e, CL);
await e.select('#clausecard select[id$="e"]', "advisory"); await w(500);
ok("switching to advisory changes the clause", binding !== await val(e, CL) && /advisory only/.test(await val(e, CL)) && /expert determination/.test(binding));
await e.select('#clausecard select[id$="k"]', "rental"); await w(500);
ok("choosing another template changes the rules named in it", /Rental deposit|Rental security deposit/.test(await val(e, CL)) && /#check\/rental/.test(await val(e, CL)));
ok("the clause never promises enforceability", !/enforceable|guarantee|legally binding/i.test(await val(e, CL)));
await e.type("#clausecard input[type=text]", "Amina Yusuf"); await w(400);
ok("a named neutral person appears in the clause", /go to Amina Yusuf, a neutral person/.test(await val(e, CL)));
await e.goto(BASE + "#agreement/1"); await w(1000);
ok("an agreement page offers the clause with its own reviewer, time limits and published rule set", await until(async () => /rule set #1, circuit #13 on X Layer/.test(await val(e, CL)) && /Within 7 days/.test(await val(e, CL)) && /wallet address 0x/.test(await val(e, CL)), 25000), await val(e, CL));

// ---- Chinese ----
const z = await page("zh");
await z.goto(BASE + "#templates"); await w(1500);
ok("the templates page is in Chinese", /从模板开始/.test(await T(z, "h1")) && (await z.$$eval(".tpl h3", hs => hs.map(h => h.textContent))).join("|") === "二手交易|自由职业里程碑付款|租房押金|漏洞赏金严重程度|保修理赔", (await z.$$eval(".tpl h3", hs => hs.map(h => h.textContent))).join("|"));
ok("its buttons and counters are in Chinese", /试用检查器/.test(await T(z, "main")) && /5 个问题|7 个问题/.test(await T(z, "main")) && /已发布在 X Layer/.test(await T(z, "main")));
ok("the advice for buyers and sellers is in Chinese", /你愿意接受 LGtie 协议吗/.test(await T(z, "main")) && /佐证材料/.test(await T(z, "main")));
await z.goto(BASE + "#templates"); await w(1500);
ok("the clause card is in Chinese and so is the clause", /写进你的合同/.test(await T(z, "#clausecard")) && /律师/.test(await T(z, "#clausecard")) && /争议处理/.test(await val(z, CL)) && /不是法院判决，也不是仲裁裁决/.test(await val(z, CL)), await T(z, "#clausecard"));
await z.goto(BASE + "#check/secondhand"); await w(1500);
ok("and the evidence labels are translated too", /证据：IMEI 或序列号查询结果/.test(await T(z, "main")) && !/Evidence:/.test(await T(z, "main")), (await T(z, "main")).slice(0, 300));
ok("the checker asks Chinese questions", /物品与商品页面的描述和照片相符吗/.test(await T(z, "main")), (await T(z, "main")).slice(0, 200));
for (let i = 0; i < 5; i++) await answer(z, i, 1);
await answer(z, 1, 0);
ok("and gives the result and the reason in Chinese", await until(async () => /全额退款/.test(await T(z, "main")) && /无法使用/.test(await T(z, "main"))), (await T(z, "main")).slice(-300));
await z.goto(BASE + "#build/secondhand"); await w(1500);
ok("the builder starts from the Chinese rules", (await z.$$eval("input", is => is.some(i => /商品页面的描述和照片/.test(i.value)))));
ok("its template buttons are in Chinese", (await z.$$eval("[data-t]", bs => bs.map(x => x.textContent))).join("|") === "二手交易|自由职业里程碑|租房押金|漏洞赏金示例|保修示例|空白", (await z.$$eval("[data-t]", bs => bs.map(x => x.textContent))).join("|"));
await z.goto(BASE + "#check/warranty"); await w(1800);
ok("the published warranty checker is still the English rules, shown in Chinese", /产品是否已登记/.test(await T(z, "main")));
await z.goto(BASE + "#for-business"); await w(1500);
ok("the business page links to the templates", /从模板开始/.test(await T(z, "main")) && (await z.$$('a[href="#templates"]')).length >= 1);

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
