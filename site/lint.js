// Rule check: a plain, offline checklist that looks at a business's questions and rules BEFORE they are published, because a published rule is permanent.
// It does not use an AI and sends nothing anywhere. It looks for the things that make a neutral reviewer's job hard:
//   - words that call for a judgement ("reasonable", "properly", "damaged") with nothing to count or see;
//   - questions that cannot be answered yes or no, or that hide two questions in one;
//   - questions with no evidence to show (and a suggested piece of evidence to add);
//   - questions no rule uses, results nothing leads to, and rules that can never fire;
//   - rules with no reason to show the customer.
// It only warns. It never blocks publishing: a word list is a heuristic and will sometimes flag wording that is fine.
// English and Chinese. Pure, so it can be tested in Node (module.exports); the builder uses window.TB_LINT.
(function (root) {
  "use strict";
  const TB = root.TB || (typeof require !== "undefined" ? require("./rules.js") : null);

  const SUBJ = {
    en: /\b(fair(ly)?|reasonabl[ey]|unreasonabl[ey]|proper(ly)?|appropriate(ly)?|adequate(ly)?|sufficient(ly)?|suitable|satisfactor(y|ily)|acceptabl[ey]|excessive(ly)?|significant(ly)?|substantial(ly)?|serious(ly)?|minor|major|normal(ly)?|good (condition|faith|quality)|bad(ly)?|poor(ly)?|decent|soon|quickly|promptly|timely|as soon as possible|undue|damag(e|ed|es))\b/gi,
    zh: /(合理|适当|恰当|适度|过度|妥善|正常|严重|轻微|良好|及时|尽快|尽早|公平|明显|相当|足够|基本|大幅|重大|损坏|损伤)/g
  };
  const MEASURE = {en: /\d|\b(hours?|days?|weeks?|months?|years?|minutes?|mm|cm|kg|percent)\b|%/i, zh: /\d|小时|天|日|周|月|年|分钟|毫米|厘米|公斤|%|百分/};
  const WH = {en: /^(what|when|who|whom|whose|why|how|which|where)\b/i, zh: /(什么|谁|为什么|为何|怎么|怎样|如何|哪个|哪些|哪里|哪种|多少)/};
  const YESNO_ZH = /(是否|吗|是不是|有没有|能否|可否|能不能)/;   // Chinese question words can sit anywhere in a sentence; these markers show it is a yes or no question
  const AND = {en: /\b(and|or|as well as)\b/i, zh: /(并且|而且|或者|以及|同时)/};
  const LIST = {en: /(such as|for example|e\.g\.|including)/i, zh: /(例如|比如|包括)/};
  const VAGUE_EVID = /^(proof|evidence|photos?|pictures?|documents?|docs?|records?|receipt|证据|证明|照片|图片|文件|记录|凭证)$/i;
  // keyword -> a piece of evidence that would settle it
  const EVID = {
    en: [[/\b(imei|serial)\b/i, "The IMEI or serial number check result"], [/\b(keys?|access cards?|handover)\b/i, "A handover message or receipt"], [/\b(revisions?)\b/i, "The revision requests and replies"],
      [/\b(paid|payment|rent|bills?|invoice|fees?)\b/i, "Payment records or invoices"], [/\b(inventory)\b/i, "The inventory list with photos"], [/\b(return(ed)?|refund|shipping|shipped|tracking)\b/i, "Tracking number and return receipt"],
      [/\b(warranty period|purchase date|bought|purchased)\b/i, "Purchase date on the receipt"], [/\b(registered|registration|proof of purchase|receipt|order)\b/i, "Receipt or order confirmation"],
      [/\b(spec|brief|requirements?|listing|description)\b/i, "The agreed brief or listing, next to what was delivered"], [/\b(deadline|on time|delivered|delivery|reported within|within \d+|date)\b/i, "A message or record that shows the date and time"],
      [/\b(work(s|ing)?|switch(es)? on|power(s)? on|runs?|opens?|builds?|compiles?|test)\b/i, "A short video or a test log showing it working"], [/\b(photos?|condition|damage[d]?|scratch(es)?|crack(s|ed)?|match(es)?)\b/i, "Dated photos of the item"]],
    zh: [[/(IMEI|序列号)/i, "IMEI 或序列号查询结果"], [/(钥匙|门禁|交接)/, "交接消息或收据"], [/(修改)/, "修改请求和回复记录"], [/(付款|租金|费用|发票)/, "付款记录或发票"], [/(清单)/, "带照片的物品清单"],
      [/(退货|退款|寄回|物流)/, "快递单号和退货凭证"], [/(保修期|购买日期)/, "收据上的购买日期"], [/(购买凭证|收据|订单|登记)/, "收据或订单确认"], [/(需求|说明书|规格|描述)/, "约定的需求说明，与交付物对照"],
      [/(截止|按时|交付|反馈|日期|时间)/, "带日期和时间的消息或记录"], [/(开机|能用|使用|运行|测试|构建|能打开)/, "展示其正常工作的短视频或测试记录"], [/(照片|状态|损坏|划痕|相符)/, "带日期的物品照片"]]
  };

  const M = {
    en: {
      subj: (w, hasEv) => `Judgement word${w.length > 1 ? "s" : ""}: ${w.map(x => "\"" + x + "\"").join(", ")}. ` + (hasEv ? "Your evidence helps, but make the question itself say what the evidence must show." : "Nothing here says how to settle it, and no evidence is listed. Say what can be seen or counted: a number, a date or a plain fact."),
      wh: w => `This is not a yes or no question: it starts with "${w}". Rewrite it so it can be answered yes or no.`,
      noq: "Word it as a question that ends with a question mark.",
      long: "This is a long question. If it hides two ideas, split it so each can be answered on its own.",
      and: w => `It contains "${w}", so it may be two questions in one. If the parts could be answered differently, split them.`,
      noevid: s => "No evidence listed. Say what proof the customer or staff should show." + (s ? ` For example: "${s}".` : " For example a dated photo, a receipt or a message."),
      vague: h => `The evidence is vague ("${h}"). Say exactly what, for example "Dated photo of the item".`,
      dup: j => `Same as question ${j}. Remove one, or word them so they differ.`,
      unusedQ: "No rule uses this question, so its answer never changes the result. Use it in a rule, or remove it.",
      unreach: n => `No combination of answers leads to the result "${n}". Add a rule that gives it, or remove it.`,
      never: n => `Rule ${n} can never decide anything: earlier rules always apply first, or its own conditions cannot all be true. Move it up or change its conditions.`,
      nowhy: n => `Rule ${n} has no reason. The customer sees the reason next to the result, so say it in plain words.`,
      nowhyDef: "The \"else\" result has no reason. The customer sees the reason next to the result, so say it in plain words.",
      oneQ: "Only one question. Most real disagreements have more than one fact to settle.",
      noAbout: "Add one line telling the customer what this checks.",
      skipped: "There are too many questions to test every combination, so unused results and rules that never fire were not checked."
    },
    zh: {
      subj: (w, hasEv) => `主观用词：${w.map(x => "“" + x + "”").join("、")}。` + (hasEv ? "你列出的证据有帮助，但请让问题本身说明证据必须证明什么。" : "这里没有说明如何判定，也没有列出证据。请写成能看到或能数出来的事实：一个数字、一个日期或一个明确的事实。"),
      wh: w => `这不是是非题：它以“${w}”开头。请改写成可以用“是”或“否”回答的问题。`,
      noq: "请写成以问号结尾的问题。",
      long: "这个问题很长。如果其中包含两个意思，请拆开，让每个问题都能单独回答。",
      and: w => `其中有“${w}”，可能是两个问题合在一起。如果这两部分可能有不同的答案，请拆开。`,
      noevid: s => "没有列出证据。请说明客户或工作人员应出示什么证明。" + (s ? `例如：“${s}”。` : "例如带日期的照片、收据或消息。"),
      vague: h => `证据太笼统（“${h}”）。请写清楚具体是什么，例如“带日期的物品照片”。`,
      dup: j => `与第 ${j} 题相同。请删除一个，或把它们写得有所区别。`,
      unusedQ: "没有任何规则用到这个问题，所以它的答案不会改变结果。请在规则中使用它，或删除它。",
      unreach: n => `没有任何答案组合会得出结果“${n}”。请添加一条能得出它的规则，或删除它。`,
      never: n => `规则 ${n} 永远不会起作用：前面的规则总会先适用，或者它自己的条件不可能同时成立。请把它上移，或修改条件。`,
      nowhy: n => `规则 ${n} 没有写原因。客户会在结果旁看到原因，请用平实的话说明。`,
      nowhyDef: "“否则”这一项没有写原因。客户会在结果旁看到原因，请用平实的话说明。",
      oneQ: "只有一个问题。大多数真实的分歧都不止一件事实需要判定。",
      noAbout: "请加一句话，告诉客户这个检查器检查什么。",
      skipped: "问题太多，无法逐一测试所有组合，因此没有检查未使用的结果和永远不会起作用的规则。"
    }
  };
  const norm = s => String(s || "").toLowerCase().replace(/[\s\p{P}]+/gu, "");

  // P: a parsed policy ({name, about, questions: [{text, hint}], results, rules: [{conds: [{q, yes}], result, why}], def: {result, why}}).
  // Returns findings: {level: "warn" | "info", where: "q" | "r" | "p", q, rule, code, msg, fix}.
  function lint(P, opts) {
    const lang = (opts && opts.lang) === "zh" ? "zh" : "en", m = M[lang], out = [], n = P.questions.length;
    const add = (level, where, code, msg, extra) => out.push(Object.assign({level, where, code, msg}, extra));
    P.questions.forEach((q, i) => {
      const text = String(q.text || "").trim(), hint = String(q.hint || "").trim();
      if (!text) return;
      const subj = [...new Set((text.match(SUBJ[lang]) || []).map(x => x.toLowerCase()))];
      if (subj.length && !MEASURE[lang].test(text)) add(hint.length >= 4 ? "info" : "warn", "q", "subjective", m.subj(subj, hint.length >= 4), {q: i});
      const wh = lang === "zh" && YESNO_ZH.test(text) ? null : WH[lang].exec(text); if (wh) add("warn", "q", "notyesno", m.wh(wh[0]), {q: i});
      else if (!/[?？]\s*$/.test(text)) add("info", "q", "noq", m.noq, {q: i});
      if (text.length > (lang === "zh" ? 70 : 140)) add("info", "q", "long", m.long, {q: i});
      const and = AND[lang].exec(text); if (and && !LIST[lang].test(text) && !wh) add("info", "q", "and", m.and(and[0]), {q: i});
      if (!hint) { const s = (EVID[lang].find(([re]) => re.test(text)) || [])[1]; add("warn", "q", "noevidence", m.noevid(s), Object.assign({q: i}, s ? {fix: {hint: s}} : {})); }
      else if (hint.length < 4 || VAGUE_EVID.test(hint)) add("info", "q", "vagueevidence", m.vague(hint), {q: i});
      const j = P.questions.findIndex((o, k) => k < i && norm(o.text) && norm(o.text) === norm(text)); if (j >= 0) add("warn", "q", "duplicate", m.dup(j + 1), {q: i});
      if (!P.rules.some(r => r.conds.some(c => c.q === i))) add("warn", "q", "unusedq", m.unusedQ, {q: i});
    });
    // results and rules: what can actually happen
    if (n <= 14) {
      const seenResult = new Set(), fired = new Set();
      for (let mask = 0; mask < 2 ** n; mask++) { const r = TB.run(P, TB.decodeAnswers(mask, n)); seenResult.add(r.result); fired.add(r.ruleIndex); }
      P.results.forEach((name, i) => { if (!seenResult.has(i)) add("warn", "r", "unreachable", m.unreach(name), {result: i}); });
      P.rules.forEach((r, i) => { if (!fired.has(i)) add("warn", "r", "neverfires", m.never(i + 1), {rule: i}); });
    } else add("info", "p", "skipped", m.skipped);
    P.rules.forEach((r, i) => { if (!String(r.why || "").trim()) add("warn", "r", "nowhy", m.nowhy(i + 1), {rule: i}); });
    if (!String((P.def && P.def.why) || "").trim()) add("warn", "r", "nowhydef", m.nowhyDef);
    if (n === 1) add("info", "p", "oneq", m.oneQ);
    if (!String(P.about || "").trim()) add("info", "p", "noabout", m.noAbout);
    return out;
  }
  const summary = f => ({fix: f.filter(x => x.level === "warn").length, consider: f.filter(x => x.level === "info").length});
  const api = {lint, summary};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TB_LINT = api;
})(typeof window !== "undefined" ? window : globalThis);
