// Unit tests for the rule check (site/lint.js): the built-in templates are clean, and deliberately bad rules are caught with the right advice, in English and Chinese.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TB = require("../site/rules.js"), T = require("../site/templates.js"), L = require("../site/lint.js");
let fails = 0; const ok = (name, cond, extra = "") => { console.log((cond ? "ok   " : "FAIL ") + name + (cond ? "" : " " + extra)); if (!cond) fails++; };
const P = text => TB.parse(text).policy;
const codes = (f, level) => f.filter(x => !level || x.level === level).map(x => x.code).sort().join(",");
// a clean two-question policy to start from
const base = `name: Test
about: Checks a thing.
question: Was it delivered within 7 days? | Delivery record with its date
question: Is the serial number on the receipt the same as on the item? | Photo of the serial number next to the receipt
result: Refund
result: No refund
rule: Q1=no -> Refund : It was late.
rule: Q2=no -> Refund : The serial numbers differ.
default: No refund : Everything checks out.
`;

for (const t of T.LIBRARY) for (const lang of ["en", "zh"]) {
  const f = L.lint(P(t[lang].text), {lang}), warns = f.filter(x => x.level === "warn");
  if (t.key === "bounty") {
    // a real finding: two of the bug-bounty questions are not used by any rule, so their answers never change the result
    ok(`${t.key} (${lang}): the check finds exactly the two questions no rule uses`, warns.length === 2 && warns.every(x => x.code === "unusedq") && warns.map(x => x.q).join(",") === "2,4", JSON.stringify(warns.map(x => [x.code, x.q])));
  } else ok(`${t.key} (${lang}): the built-in template has no warnings`, warns.length === 0, codes(f, "warn") + " | " + warns.map(x => x.msg).join(" / "));
}
ok("a clean policy has no warnings", !L.lint(P(base), {lang: "en"}).some(x => x.level === "warn"), codes(L.lint(P(base), {lang: "en"})));
ok("the check is deterministic", JSON.stringify(L.lint(P(base), {lang: "en"})) === JSON.stringify(L.lint(P(base), {lang: "en"})));

// ---- judgement words ----
const subj = q => L.lint(P(base.replace("Was it delivered within 7 days? | Delivery record with its date", q)), {lang: "en"});
ok("a judgement word with no evidence is a warning", codes(subj("Was the item handled properly?"), "warn").includes("subjective") && codes(subj("Was the item handled properly?"), "warn").includes("noevidence"));
ok("a judgement word WITH evidence is only something to consider", (() => { const f = subj("Was the item handled properly? | Photos of the item"); return f.some(x => x.code === "subjective" && x.level === "info") && !f.some(x => x.code === "subjective" && x.level === "warn"); })());
ok("a number or a unit makes the word acceptable (nothing to flag)", !subj("Was the delay reasonable, under 48 hours? | Delivery record").some(x => x.code === "subjective") && !subj("Is the screen damaged by a crack longer than 2 mm? | Photo with a ruler").some(x => x.code === "subjective"));
ok("it names the word it found", subj("Was the repair done in a timely and satisfactory way? | Invoice").find(x => x.code === "subjective").msg.match(/"timely".*"satisfactory"|"satisfactory".*"timely"/) !== null);
ok("it does not flag plain wording", !subj("Is the order number on the receipt? | Receipt").some(x => x.code === "subjective"));

// ---- shape of the question ----
ok("a question that starts with 'what' is not yes or no", subj("What condition is the item in? | Photos").some(x => x.code === "notyesno" && x.level === "warn"));
ok("a statement with no question mark gets a gentle note", subj("The item arrived on time | Delivery record").some(x => x.code === "noq" && x.level === "info"));
ok("'and' or 'or' suggests two questions in one (a note, not a warning)", subj("Was it delivered and installed? | Delivery record").some(x => x.code === "and" && x.level === "info"));
ok("a list of examples is not flagged as two questions", !subj("Is there damage, for example a crack or a dent? | Photos").some(x => x.code === "and"));
ok("a very long question is noted", subj("Is it true that " + "the item was carefully packed in the original box with all the accessories ".repeat(3) + "when it was sent? | Photos").some(x => x.code === "long"));

// ---- evidence ----
const noEv = L.lint(P(base.replace(" | Delivery record with its date", "")), {lang: "en"}).find(x => x.code === "noevidence");
ok("a question with no evidence is a warning, with a suggestion that can be used", noEv && noEv.level === "warn" && noEv.fix && noEv.fix.hint === "A message or record that shows the date and time", JSON.stringify(noEv));
ok("evidence suggestions fit the topic", [["Is the IMEI clean?", "The IMEI or serial number check result"], ["Was the rent paid in full?", "Payment records or invoices"], ["Does the phone switch on?", "A short video or a test log showing it working"], ["Were the keys returned?", "A handover message or receipt"]].every(([q, s]) => (L.lint(P(base.replace("Was it delivered within 7 days? | Delivery record with its date", q)), {lang: "en"}).find(x => x.code === "noevidence") || {fix: {}}).fix.hint === s));
ok("with nothing to go on it still gives general advice but no fix", (() => { const x = L.lint(P(base.replace("Was it delivered within 7 days? | Delivery record with its date", "Is the sky clear?")), {lang: "en"}).find(x => x.code === "noevidence"); return x && !x.fix && /dated photo, a receipt or a message/.test(x.msg); })());
ok("vague evidence is noted", L.lint(P(base.replace("Delivery record with its date", "proof")), {lang: "en"}).some(x => x.code === "vagueevidence"));

// ---- duplicates and unused questions ----
const dup = L.lint(P(base.replace("Is the serial number on the receipt the same as on the item? | Photo of the serial number next to the receipt", "Was it delivered within 7 days?  | Another record")), {lang: "en"});
ok("a repeated question is a warning that points at the first one", dup.some(x => x.code === "duplicate" && x.q === 1 && /question 1/.test(x.msg)));
const unused = L.lint(P(base.replace("rule: Q2=no -> Refund : The serial numbers differ.\n", "")), {lang: "en"});
ok("a question no rule uses is a warning", unused.some(x => x.code === "unusedq" && x.q === 1));

// ---- results and rules that cannot happen ----
const unreach = L.lint(P(base.replace("result: No refund\n", "result: No refund\nresult: Half refund\n")), {lang: "en"});
ok("a result nothing leads to is a warning", unreach.some(x => x.code === "unreachable" && /Half refund/.test(x.msg)));
const shadow = L.lint(P(base.replace("rule: Q1=no -> Refund : It was late.\n", "rule: Q1=no -> Refund : It was late.\nrule: Q1=no & Q2=no -> Refund : Both.\n")), {lang: "en"});
ok("a rule that an earlier rule always covers can never fire", shadow.some(x => x.code === "neverfires" && x.rule === 1));
ok("rules that do fire are not flagged", !L.lint(P(base), {lang: "en"}).some(x => x.code === "neverfires" || x.code === "unreachable"));

// ---- reasons and the rest ----
const nowhy = L.lint(P(base.replace("rule: Q1=no -> Refund : It was late.", "rule: Q1=no -> Refund")), {lang: "en"});
ok("a rule with no reason is a warning", nowhy.some(x => x.code === "nowhy" && x.rule === 0));
ok("an 'else' with no reason is a warning", L.lint(P(base.replace("default: No refund : Everything checks out.", "default: No refund")), {lang: "en"}).some(x => x.code === "nowhydef"));
ok("a missing one-line description is noted", L.lint(P(base.replace("about: Checks a thing.\n", "")), {lang: "en"}).some(x => x.code === "noabout" && x.level === "info"));
ok("a single question is noted", L.lint(P("name: One\nabout: a\nquestion: Is it ok? | Photo of it\nresult: Yes\nresult: No\nrule: Q1=no -> No : Not ok.\ndefault: Yes : Ok."), {lang: "en"}).some(x => x.code === "oneq"));
ok("with many questions it says it could not test every combination", L.lint(P("name: Big\nabout: a\n" + Array.from({length: 15}, (_, i) => `question: Is condition number ${i + 1} met? | Record ${i + 1}`).join("\n") + "\nresult: A\nresult: B\nrule: Q1=no -> B : No.\ndefault: A : Yes."), {lang: "en"}).some(x => x.code === "skipped"));
ok("the summary counts warnings and notes", (() => { const s = L.summary(nowhy); return s.fix >= 1 && s.consider >= 0 && s.fix + s.consider === nowhy.length; })());

// ---- Chinese ----
const zbase = `name: 测试
about: 检查一件事。
question: 是否在 7 天内送达？ | 带日期的送达记录
question: 序列号与收据上的一致吗？ | 序列号与收据的合照
result: 退款
result: 不退款
rule: Q1=no -> 退款 : 送达太晚。
rule: Q2=no -> 退款 : 序列号不一致。
default: 不退款 : 一切正常。
`;
const zf = q => L.lint(P(zbase.replace("是否在 7 天内送达？ | 带日期的送达记录", q)), {lang: "zh"});
ok("a clean Chinese policy has no warnings", !L.lint(P(zbase), {lang: "zh"}).some(x => x.level === "warn"));
ok("Chinese: a judgement word without evidence is a warning, in Chinese", zf("物品是否被妥善保管？").some(x => x.code === "subjective" && x.level === "warn" && /主观用词：“妥善”/.test(x.msg)));
ok("Chinese: a number makes it acceptable", !zf("物品是否在合理的 7 天内送达？ | 送达记录").some(x => x.code === "subjective"));
ok("Chinese: a question that is not yes or no is caught", zf("物品是什么状态？ | 照片").some(x => x.code === "notyesno" && /这不是是非题/.test(x.msg)));
ok("Chinese: missing evidence gets a Chinese suggestion that can be used", (() => { const x = zf("钥匙是否已归还？").find(x => x.code === "noevidence"); return x && x.fix && x.fix.hint === "交接消息或收据" && /没有列出证据/.test(x.msg); })());
ok("Chinese: a rule with no reason is caught", L.lint(P(zbase.replace("rule: Q1=no -> 退款 : 送达太晚。", "rule: Q1=no -> 退款")), {lang: "zh"}).some(x => x.code === "nowhy" && /没有写原因/.test(x.msg)));
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
