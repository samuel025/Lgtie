import puppeteer from "puppeteer-core"; import fs from "node:fs";
const BASE = "http://localhost:8090/index.html#build";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 300))); if (!c) fails++; };
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
const set = async (sel, val) => { await p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); e.dispatchEvent(new Event("change", {bubbles: true})); }, val); };
const count = sel => p.$$eval(sel, e => e.length);
await p.setViewport({width: 1000, height: 1000}); await p.goto(BASE); await w(700);
ok("forms show 7 questions", await count("[data-qi]") === 7); ok("forms show 7 rules", await count("[data-ui]") === 7);
ok("circuit matches rules", /same answer as your rules/.test(await T("#out")), await T("#out"));
// add a question: empty text is an error until typed
await p.click('[data-a="qadd"]'); await w(500);
ok("an empty question is reported", /needs some text/.test(await T("#out")), await T("#out"));
await set('[data-qi="7"] [data-f="qt"]', "Is the receipt readable?"); await w(500);
ok("typing the question fixes it", /same answer as your rules/.test(await T("#out")), await T("#out"));
ok("8 questions now", /8 questions/.test(await T("#out")));
// add a rule on the new question
await p.click('[data-a="ruleadd"]'); await w(300);
const ri = (await count("[data-ui]")) - 1;
const cell = `[data-ui="${ri}"] [data-a="cell"][data-q="7"]`;
ok("a new rule starts with every cell on any", (await p.$eval(cell, e => e.textContent.trim())) === "any");
await p.click(cell); await w(200); ok("clicking a cell once makes it Yes", (await p.$eval(cell, e => e.textContent.trim())) === "Yes");
await p.click(cell); await w(200); ok("clicking again makes it No", (await p.$eval(cell, e => e.textContent.trim())) === "No");
await set(`[data-ui="${ri}"] [data-f="rr"]`, "1"); await set(`[data-ui="${ri}"] [data-f="rw"]`, "The receipt cannot be read."); await w(500);
ok("a new rule is accepted and verified", /8 rules/.test(await T("#out")) && /same answer as your rules/.test(await T("#out")), await T("#out"));
// the live preview names the rule that fired
await p.evaluate(() => document.querySelectorAll("#tq .tg").forEach(g => g.querySelector('button[data-v="1"]').click())); await w(200);
await p.click('#tq .tg[data-i="7"] button[data-v="0"]'); await w(300);
ok("the try-it panel lights the rule that fired", (await p.$$eval(".rrow.hit", e => e.length)) === 1 && /Rule 8 decided this/.test(await T("#tf")), await T("#tf"));
// the new rule behaves: open the checker link text
const text = await p.evaluate(async () => { const t = document.querySelector("#tabt"); t.click(); return document.querySelector("#src").value; });
ok("text view shows the new rule", /rule: Q8=no -> Needs review : The receipt cannot be read\./.test(text), text.slice(-400));
// edit text, switch back
await set("#src", text.replace("name: Warranty claims", "name: Acme Laptop warranty")); await w(500);
await p.click("#tabv"); await w(500);
ok("name edit in text carries over to forms", (await p.$eval("#f-name", e => e.value)) === "Acme Laptop warranty");
// break the text and try to go back to forms
await p.click("#tabt"); await w(300); await set("#src", "name: x\nrule: nonsense"); await w(500); await p.click("#tabv"); await w(300);
ok("switching with bad text stays and explains", /Fix the text before switching/.test(await T("#out")) && (await p.$("#src")) !== null, await T("#out"));
await p.evaluate(() => document.querySelector("[data-t=warranty]").click()); await w(500); // reloads the template (mode is text)
await p.click("#tabv"); await w(400);
// delete question 1: rules on Q1 disappear, others shift, still verified
const before = await count("[data-ui]");
await p.click('[data-qi="0"] [data-a="qdel"]'); await w(500);
ok("deleting a question drops rules that used it", (await count("[data-ui]")) === before - 1 && (await count("[data-qi]")) === 6, `${before} -> ${await count("[data-ui]")}`);
ok("still verified after delete", /same answer as your rules/.test(await T("#out")), await T("#out"));
// move a rule down
const first = await p.$eval('[data-ui="0"] [data-f="rw"]', e => e.value);
await p.click('[data-ui="0"] [data-a="rdn"]'); await w(400);
ok("moving a rule down swaps it", (await p.$eval('[data-ui="1"] [data-f="rw"]', e => e.value)) === first);
// spreadsheet paste
await p.$eval("#editor details summary", e => e.click());
const nr = await count("[data-ui]");
await set("#pr", "Q1=yes\tCovered\tTest reason\nBAD ROW\tX\tY"); await p.click('[data-a="paster"]'); await w(500);
ok("pasting rules adds good rows and skips bad ones", (await count("[data-ui]")) === nr + 1 && /Skipped row 2/.test(await p.$eval("#pmsg", e => e.textContent)), await p.$eval("#pmsg", e => e.textContent));
await set("#pq", "Is it new?\tReceipt\nIs it boxed?\t"); await p.click('[data-a="pasteq"]'); await w(500);
ok("pasting questions adds them", (await count("[data-qi]")) === 8);
// AI helper
await p.evaluate(() => { document.querySelector("#ai summary").click(); });
const bounty = fs.readFileSync("/home/samuel/Documents/tiebreak/site/rules.js", "utf8").match(/bounty: `([\s\S]*?)`/)[1];
await set("#aiin", bounty); await p.click("#aiuse"); await w(600);
ok("an assistant's reply loads into the forms", await count("[data-qi]") === 8 && (await p.$eval("#f-name", e => e.value)) === "Bug bounty severity", await T("#aimsg"));
await set("#aiin", "this is not rules"); await p.click("#aiuse"); await w(300);
ok("a bad reply is explained, nothing is lost", /Line 1/.test(await T("#aimsg")) && (await p.$eval("#f-name", e => e.value)) === "Bug bounty severity", await T("#aimsg"));
// blank
await p.evaluate(() => document.querySelector("[data-t=blank]").click()); await w(500);
ok("blank starts with one empty question and says so", await count("[data-qi]") === 1 && /needs some text/.test(await T("#out")));
ok("no page errors", errs.length === 0, errs.join(" | "));
await p.screenshot({path: "/tmp/tb-builder.png", fullPage: true});
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
