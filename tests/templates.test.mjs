// Unit tests for the rule templates (site/templates.js): every template, in English and Chinese, must parse, compile to a circuit that equals the
// rules on every answer combination, reach every result, and behave identically in both languages.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TB = require("../site/rules.js"), T = require("../site/templates.js");
let fails = 0; const ok = (name, cond, extra = "") => { console.log((cond ? "ok   " : "FAIL ") + name + (cond ? "" : " " + extra)); if (!cond) fails++; };

const shape = P => JSON.stringify({q: P.questions.length, results: P.results.length, rules: P.rules.map(r => ({c: r.conds.map(c => [c.q, c.yes]), r: r.result})), def: P.def.result});
const reach = P => { const seen = new Set(), n = P.questions.length; for (let m = 0; m < 2 ** n; m++) seen.add(TB.run(P, TB.decodeAnswers(m, n)).result); return seen; };

ok("the library has the five templates", T.LIBRARY.map(t => t.key).sort().join(",") === "bounty,freelance,rental,secondhand,warranty");
for (const t of T.LIBRARY) for (const lang of ["en", "zh"]) {
  const text = t[lang].text, r = TB.parse(text), tag = `${t.key} (${lang})`;
  ok(`${tag}: parses without errors`, !r.errors.length, JSON.stringify(r.errors));
  const P = r.policy, C = TB.compile(P), v = TB.verify(P, C);
  ok(`${tag}: the circuit equals the rules on ${v.checked} answer combinations`, v.ok, JSON.stringify(v));
  ok(`${tag}: every result can be reached`, reach(P).size === P.results.length, `${reach(P).size} of ${P.results.length}`);
  ok(`${tag}: every question has evidence to show`, P.questions.every(q => q.hint && q.hint.length > 3));
  ok(`${tag}: every rule says why`, P.rules.every(x => x.why && x.why.length > 5) && P.def.why.length > 5);
  ok(`${tag}: a small circuit (${C.gates.length} gates)`, C.gates.length < 400);
}
for (const t of T.LIBRARY) {
  const en = TB.parse(t.en.text).policy, zh = TB.parse(t.zh.text).policy;
  ok(`${t.key}: the Chinese rules behave exactly like the English ones`, shape(en) === shape(zh));
  ok(`${t.key}: and give the same result number on every answer combination`, (() => { for (let m = 0; m < 2 ** en.questions.length; m++) { const a = TB.decodeAnswers(m, en.questions.length); if (TB.run(en, a).result !== TB.run(zh, a).result) return false; } return true; })());
}
ok("the warranty text is exactly the one published on X Layer (its fingerprint is on-chain)", T.find("warranty").en.text === TB.TEMPLATES.warranty);

// language selection
globalThis.TB_I18N = {lang: "zh"}; globalThis.TB_CONFIG = {published: {warranty: {circuitId: 13, ruleSetId: 1}}};
ok("in Chinese the builder starts from Chinese rules", /^name: 二手交易/.test(T.templateText("secondhand")) && /^name: 保修理赔/.test(T.templateText("warranty")));
ok("a published template stays in English on its checker page, whatever the language", T.templateText("warranty", true) === TB.TEMPLATES.warranty);
ok("an unpublished template follows the language on its checker page", /^name: 二手交易/.test(T.templateText("secondhand", true)));
globalThis.TB_I18N = {lang: "en"};
ok("in English everything is English", T.templateText("secondhand") === T.find("secondhand").en.text && T.templateText("warranty") === TB.TEMPLATES.warranty);
ok("an unknown key returns nothing", T.templateText("nope") === undefined);

// ---- the clause for a written contract ----
const base = {key: "freelance", effect: "binding", reviewer: "Amina Yusuf", answerDays: 7, reviewDays: 14, link: "https://lgtie.example/#check/freelance", hash: "0x" + "ab".repeat(32), lang: "en"};
const en = T.clause(base), enAdv = T.clause({...base, effect: "advisory"}), zhc = T.clause({...base, lang: "zh"});
ok("the clause names the rules, the link and the rules fingerprint", /"Freelance milestone"/.test(en) && en.includes(base.link) && en.includes("0xabababababababab…"));
ok("it gives the time limits and the neutral person", /Within 7 days of a written notice of dispute/.test(en) && /written reasons within 14 days/.test(en) && /go to Amina Yusuf, a neutral person/.test(en));
ok("binding: an expert determination of questions of fact that can still be challenged for fraud, manifest error or lack of impartiality", /expert determination of those questions of fact/.test(en) && /fraud, manifest error or lack of impartiality/.test(en) && !/advisory only/.test(en));
ok("advisory: considered in good faith before court or arbitration, and not binding", /advisory only/.test(enAdv) && /before starting court or arbitration/.test(enAdv) && !/bound by that outcome/.test(enAdv));
ok("it never calls the outcome an award or a judgment, and says it is neither", /not a court judgment or an arbitral award/.test(en) && !/arbitral award\b(?! *\.)/.test(en.replace("not a court judgment or an arbitral award", "")));
ok("it leaves the right to go to court or to arbitration alone", /does not limit either party's right to go to court or to arbitration/.test(en));
ok("it tells the parties the record is public", /recorded on a public blockchain and can be seen by anyone/.test(en));
ok("it does not give legal advice or promise enforceability", !/enforceable|guarantee|legally binding/i.test(en + enAdv));
ok("a missing neutral person falls back to the one named in the agreement", /named in the agreement, or agreed by the parties in writing/.test(T.clause({...base, reviewer: ""})));
ok("a published rule set is named with its circuit", /rule set #1, circuit #13 on X Layer/.test(T.clause({...base, key: "warranty", published: {ruleSetId: 1, circuitId: 13}})));
ok("the Chinese clause says the same things", /争议处理/.test(zhc) && /专家裁定/.test(zhc) && /不是法院判决，也不是仲裁裁决/.test(zhc) && /公共区块链/.test(zhc) && /不限制任何一方/.test(zhc) && zhc.includes(base.link) && /7 日内/.test(zhc) && /14 日内/.test(zhc));
ok("and the Chinese advisory one is advisory", /仅供参考/.test(T.clause({...base, lang: "zh", effect: "advisory"})) && !/具有约束力/.test(T.clause({...base, lang: "zh", effect: "advisory"})));
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
