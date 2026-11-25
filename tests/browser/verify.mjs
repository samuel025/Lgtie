// The formal check in the product: the builder proves its own circuit for every answer combination and offers a report; a published circuit can be read back
// from X Layer and proved equal to the rules, on the checker page and on the Verify page; wrong circuits are explained; and it all works in Chinese.
// Reads X Layer mainnet (read-only: circuit #13). Needs the site on http://localhost:8090 and puppeteer-core.
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
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(300); } return false; };
const answer = async (p, i, v) => { const g = (await p.$$(".yn"))[i], btn = await g.$(`button[data-v="${v}"]`); await btn.evaluate(e => e.scrollIntoView({block: "center", behavior: "instant"})); await w(120); await btn.click(); };

const e = await page("en");
// ---- the builder ----
await e.goto(BASE + "#build/secondhand"); await w(1500); await e.click('[data-step-btn="3"]'); await w(600);
ok("the builder proves the circuit for every answer combination", await until(async () => /Proved: the circuit and the rules always agree/.test(await T(e, "#out"))) && /all 32 possible answer combinations \(2\^5\), not a sample/.test(await T(e, "#out")), (await T(e, "#out")).slice(0, 400));
ok("and says plainly what that does and does not prove", /does not prove the rules are fair or the answers are true/.test(await T(e, "#out")));
const rep = await e.evaluate(async () => { const orig = URL.createObjectURL; let blob = null; URL.createObjectURL = b => { blob = b; return orig.call(URL, b); }; HTMLAnchorElement.prototype.click = function () {}; document.querySelector("#dlrep").click(); await new Promise(r => setTimeout(r, 800)); URL.createObjectURL = orig; return blob ? await blob.text() : null; });
const R = rep ? JSON.parse(rep) : {};
ok("the report names the tool, compiler, method and result", R.tool === "lgtie-verify/1" && R.compiler === "lgtie-nand-compiler/1" && /ROBDD symbolic equivalence over all 2\^5/.test(R.method || "") && R.result === "equivalent", rep && rep.slice(0, 200));
ok("and both fingerprints (the rules text and the netlist bytes)", /^0x[0-9a-f]{64}$/.test((R.policy || {}).rulesFingerprintSha256 || "") && /^0x[0-9a-f]{64}$/.test((R.circuit || {}).netlistFingerprintSha256 || ""));
ok("and what it did not prove", Array.isArray(R.doesNotProve) && R.doesNotProve.length >= 3);
// a policy far too big to enumerate: 20 questions
await e.goto(BASE + "#build"); await w(800);
ok("a big policy (more questions than can be tried one by one) is still proved in full", await e.evaluate(async () => {
  const q = Array.from({length: 20}, (_, i) => `question: Is condition ${i + 1} met? | Record ${i + 1}`).join("\n"), r = Array.from({length: 10}, (_, i) => `rule: Q${i + 1}=no & Q${i + 11}=yes -> No : fails ${i}`).join("\n");
  const P = TB.parse(`name: Big\nabout: big\n${q}\nresult: Yes\nresult: No\n${r}\ndefault: Yes : fine\n`).policy, C = TB.compile(P), res = TB_VERIFY.check(P, C.hex), sim = TB.verify(P, C);
  return res.result === "equivalent" && !sim.exhaustive && sim.checked === 4096; }));

// ---- a published circuit, read back from X Layer ----
await e.goto(BASE + "#check/warranty"); await w(1500);
for (let i = 0; i < 7; i++) await answer(e, i, 1);
await e.evaluate(() => { const d = [...document.querySelectorAll("details")].find(x => /Check this result yourself/.test(x.innerText)); if (d) d.open = true; });
ok("the checker page offers a formal check for the published warranty circuit", await until(async () => !!(await e.$("#fv [data-fv]")), 20000) && /Read the circuit from X Layer/.test(await T(e, "#fv")), await T(e, "#fv"));
await e.$eval("#fv [data-fv]", x => x.scrollIntoView({block: "center", behavior: "instant"})); await w(150); await e.click("#fv [data-fv]");
ok("it reads circuit #13 from the chain and proves it equal to the rules", await until(async () => /Proved: the circuit and the rules always agree/.test(await T(e, "#fv")), 40000) && /all 128 possible answer combinations \(2\^7\)/.test(await T(e, "#fv")) && /39 gates/.test(await T(e, "#fv")), await T(e, "#fv"));
ok("and shows the two fingerprints and a report to download", /Rules fingerprint\s+0x[0-9a-f]{64}/.test(await T(e, "#fv")) && /Circuit fingerprint\s+0x[0-9a-f]{64}/.test(await T(e, "#fv")) && !!(await e.$("#fv [data-dlrep]")));

// ---- the Verify page ----
await e.goto(BASE + "#verify"); await w(1200);
await e.type("#fcid", "13"); await e.click("#fgo");
ok("the Verify page proves circuit #13 equals the warranty rules", await until(async () => /Proved: the circuit and the rules always agree/.test(await T(e, "#fout")), 40000), await T(e, "#fout"));
await e.select("#frs", "bounty"); await e.click("#fgo");
ok("the same circuit against the bug-bounty rules is refused with a plain reason (wrong number of inputs)", await until(async () => /has 7 inputs and 2 outputs, but these rules have 8 questions/.test(await T(e, "#fout")), 40000), await T(e, "#fout"));
await e.select("#frs", "custom");
const custom = "name: Tiny\\nabout: a\\nquestion: Is a true? | Proof a\\nquestion: Is b true? | Proof b\\nquestion: Is c true? | Proof c\\nquestion: Is d true? | Proof d\\nquestion: Is e true? | Proof e\\nquestion: Is f true? | Proof f\\nquestion: Is g true? | Proof g\\nresult: Yes\\nresult: No\\nresult: Maybe\\nresult: Later\\nrule: Q1=no -> No : a is false.\\ndefault: Yes : ok.\\n";
await e.$eval("#frt", (t, v) => { t.value = v.replace(/\\n/g, "\n"); }, custom); await e.click("#fgo");
ok("rules of the right size that the circuit does NOT implement are caught, with a counterexample", await until(async () => /The circuit and the rules disagree/.test(await T(e, "#fout")) && /For example when the answers are Q1=/.test(await T(e, "#fout")), 40000), await T(e, "#fout"));
await e.$eval("#fcid", x => { x.value = ""; }); await e.click("#fgo");
ok("a missing circuit number is asked for", /Enter a circuit number/.test(await T(e, "#fout")));
await e.type("#fcid", "99999999"); await e.select("#frs", "warranty"); await e.click("#fgo");
ok("a circuit that does not exist is explained, not a crash", await until(async () => /Could not read that circuit|inputs and/.test(await T(e, "#fout")), 40000), await T(e, "#fout"));

// ---- Chinese ----
const z = await page("zh");
await z.goto(BASE + "#build/secondhand"); await w(1500); await z.click('[data-step-btn="3"]'); await w(600);
ok("in Chinese the builder's proof is in Chinese", await until(async () => /已证明：电路与你的规则始终一致/.test(await T(z, "#out"))) && /对全部 32 种（2\^5）可能的答案组合都做了符号化检查/.test(await T(z, "#out")) && /下载验证报告/.test(await T(z, "#out")), (await T(z, "#out")).slice(0, 300));
await z.goto(BASE + "#verify"); await w(1200);
await z.type("#fcid", "13"); await z.click("#fgo");
ok("in Chinese the chain check works and speaks Chinese", await until(async () => /已证明：电路与你的规则始终一致/.test(await T(z, "#fout")) && /对全部 128 种/.test(await T(z, "#fout")), 40000), await T(z, "#fout"));
ok("and the card around it is translated", /对照规则检查电路/.test(await T(z, "main")) && /对照链上检查/.test(await T(z, "main")));

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
