// One-click rule templates for common arguments, in English and Chinese, and the #templates page.
//  - Every template is ordinary rules text (the same format the builder reads), so each one gets a free checker (#check/<key>) and can be
//    opened in the builder (#build/<key>) and changed. Nothing is published on X Layer until the person using it publishes it.
//  - English is the canonical text. The published warranty rules are always checked in English, because their fingerprint is recorded on-chain.
//    Everything else follows the page language, so a Chinese-speaking user starts from Chinese questions.
//  - Rules are checked top to bottom and the first match decides. Questions are worded so that "yes" is the good answer.
// Pure data and functions work in Node (module.exports) for tests; the page uses the browser.
(function (root) {
  "use strict";
  const TB = root.TB || (typeof require !== "undefined" ? require("./rules.js") : null);

  const LIBRARY = [
    {key: "secondhand",
      en: {chip: "Second-hand sale", title: "Second-hand sale", blurb: "A used phone, laptop or part is not as described.", text: `name: Second-hand sale
about: Agree a refund or return in advance, for when a used item is not as described.
question: Does the item match the description and photos in the listing? | Listing screenshot and photos of what arrived
question: Does the item switch on and work normally? | Video of the item being switched on
question: Is the IMEI or serial number clean, not blocked, locked or reported lost? | IMEI or serial number check
question: Was the problem reported within 48 hours of delivery? | Delivery confirmation and the message with its time
question: If the item is being returned, is it sent back in the condition it arrived in? | Photos taken before sending it back
result: Full refund
result: No refund
rule: Q4=no -> No refund : The problem was not reported within 48 hours of delivery.
rule: Q5=no -> No refund : The item was not returned in the condition it arrived in.
rule: Q3=no -> Full refund : The item is blocked, locked or reported lost, which the seller should have said.
rule: Q1=no -> Full refund : The item does not match the listing.
rule: Q2=no -> Full refund : The item does not work and the listing did not say so.
default: No refund : The item matches the listing, works, and has no lock or block.
`},
      zh: {chip: "二手交易", title: "二手交易", blurb: "二手手机、电脑或配件与描述不符。", text: `name: 二手交易
about: 在交易前先约定好：二手物品与描述不符时如何退款或退货。
question: 物品与商品页面的描述和照片相符吗？ | 商品页面截图和收到物品的照片
question: 物品能正常开机并正常使用吗？ | 物品开机的视频
question: IMEI 或序列号是干净的，没有被拉黑、锁定或报失吗？ | IMEI 或序列号查询结果
question: 是否在收货后 48 小时内反馈了问题？ | 签收确认，以及带时间的聊天记录
question: 如果需要退货，物品是否以收到时的状态寄回？ | 寄回前拍摄的照片
result: 全额退款
result: 不退款
rule: Q4=no -> 不退款 : 没有在收货后 48 小时内反馈问题。
rule: Q5=no -> 不退款 : 物品没有以收到时的状态退回。
rule: Q3=no -> 全额退款 : 物品被拉黑、锁定或报失，卖家本应事先说明。
rule: Q1=no -> 全额退款 : 物品与商品描述不符。
rule: Q2=no -> 全额退款 : 物品无法使用，而且商品描述中没有说明。
default: 不退款 : 物品与描述相符，能正常使用，也没有锁定或拉黑。
`}},
    {key: "freelance",
      en: {chip: "Freelance milestone", title: "Freelance milestone", blurb: "The client and the freelancer disagree about delivered work.", text: `name: Freelance milestone
about: Agree in advance how a milestone is paid when the client and the freelancer disagree about the work.
question: Was the work delivered by the agreed deadline? | Delivery message with its time
question: Does the delivered work match the agreed brief or spec? | The brief next to the deliverable
question: Does it work as described (it opens, builds or runs)? | Test run or screen recording
question: Were the agreed number of revisions completed? | Revision requests and replies
result: Pay in full
result: Pay half
result: Do not pay
rule: Q2=no & Q3=no -> Do not pay : The work neither matches the brief nor works.
rule: Q2=no -> Pay half : The work runs, but does not match the agreed brief.
rule: Q3=no -> Pay half : The work matches the brief, but does not work properly.
rule: Q1=no -> Pay half : The work was delivered after the deadline.
rule: Q4=no -> Pay half : The agreed revisions were not completed.
default: Pay in full : Delivered on time, matches the brief, works, and the revisions are done.
`},
      zh: {chip: "自由职业里程碑", title: "自由职业里程碑付款", blurb: "客户与自由职业者对交付的成果有分歧。", text: `name: 自由职业里程碑付款
about: 事先约定：当客户与自由职业者对成果有分歧时，这一阶段的款项怎么付。
question: 成果是否在约定的截止时间前交付？ | 带时间的交付消息
question: 交付的成果是否符合约定的需求说明？ | 需求说明与交付物对照
question: 成果能按描述正常使用吗（能打开、能构建或能运行）？ | 测试运行或屏幕录像
question: 约定次数的修改是否已完成？ | 修改请求和回复记录
result: 全额支付
result: 支付一半
result: 不支付
rule: Q2=no & Q3=no -> 不支付 : 成果既不符合需求说明，也无法正常使用。
rule: Q2=no -> 支付一半 : 成果能运行，但不符合约定的需求说明。
rule: Q3=no -> 支付一半 : 成果符合需求说明，但无法正常使用。
rule: Q1=no -> 支付一半 : 成果在截止时间之后才交付。
rule: Q4=no -> 支付一半 : 约定的修改没有完成。
default: 全额支付 : 按时交付，符合需求说明，能正常使用，修改也已完成。
`}},
    {key: "rental",
      en: {chip: "Rental deposit", title: "Rental deposit", blurb: "How much of the deposit goes back when a tenancy ends.", text: `name: Rental security deposit
about: Agree in advance how much of the deposit is returned when a tenancy ends. A starting point only: local law may set its own rules.
question: Were the keys and access cards returned on the agreed date? | Handover message or receipt
question: Is the property free of damage beyond normal wear and tear? | Move-in and move-out photos
question: Are the items on the inventory all there and working? | Inventory list with photos
question: Was the property left reasonably clean, as it was at move-in? | Move-in and move-out photos
question: Is all rent and all bills paid up to the end date? | Payment records
result: Return the full deposit
result: Keep part of the deposit
result: Needs review
rule: Q5=no -> Keep part of the deposit : Rent or bills are unpaid.
rule: Q2=no -> Keep part of the deposit : There is damage beyond normal wear and tear.
rule: Q3=no -> Keep part of the deposit : Items from the inventory are missing or not working.
rule: Q4=no -> Keep part of the deposit : The property was not left reasonably clean.
rule: Q1=no -> Needs review : The keys were not returned on the agreed date, so a person should look at it.
default: Return the full deposit : Keys returned, no damage, inventory complete, clean, and everything paid.
`},
      zh: {chip: "租房押金", title: "租房押金", blurb: "租期结束时押金退多少。", text: `name: 租房押金
about: 事先约定：租期结束时押金退多少。这只是一个起点，当地法律可能另有规定。
question: 钥匙和门禁卡是否在约定日期归还？ | 交接消息或收据
question: 房屋是否没有超出正常损耗的损坏？ | 入住和退租时的照片
question: 清单上的物品是否齐全且能正常使用？ | 带照片的物品清单
question: 房屋是否保持了入住时那样的基本整洁？ | 入住和退租时的照片
question: 租金和各项费用是否已付清至结束日期？ | 付款记录
result: 全额退还押金
result: 扣留部分押金
result: 需要复核
rule: Q5=no -> 扣留部分押金 : 租金或费用尚未付清。
rule: Q2=no -> 扣留部分押金 : 存在超出正常损耗的损坏。
rule: Q3=no -> 扣留部分押金 : 清单上的物品缺失或无法使用。
rule: Q4=no -> 扣留部分押金 : 房屋没有保持基本整洁。
rule: Q1=no -> 需要复核 : 钥匙没有在约定日期归还，因此需要由人工查看。
default: 全额退还押金 : 钥匙已归还、无损坏、清单齐全、整洁，且款项已付清。
`}},
    {key: "bounty",
      en: {chip: "Bug bounty example", title: "Bug bounty severity", blurb: "How serious is a reported vulnerability?", text: null},
      zh: {chip: "漏洞赏金示例", title: "漏洞赏金严重程度", blurb: "所报告的漏洞有多严重？", text: `name: 漏洞赏金严重程度
about: 通过回答简单的问题，而不是争论等级标签，来商定所报告漏洞的严重程度。
question: 攻击者无需任何特殊角色或权限就能发起吗？ | 来自无特权账户的复现步骤
question: 它会导致未经授权的资金或资产损失吗？ | 概念验证或交易追踪
question: 它会影响多个用户或资金池吗？ | 展示第二个受害者的概念验证
question: 它无需任何受害者签名或点击就能生效吗？ | 无需受害者操作的演示
question: 攻击者能以同样效果重复实施吗？ | 在同一分叉上再运行一次
question: 损害是永久性的，项目无法逆转吗？ | 恢复方案分析
question: 审核人能在分叉网络或测试网上复现吗？ | 审核人的复现记录
question: 受影响的资产在项目公布的范围清单内吗？ | 范围条目链接
result: 驳回
result: 低危
result: 中危
result: 高危
result: 严重
rule: Q8=no -> 驳回 : 受影响的资产不在项目的范围内。
rule: Q7=no -> 驳回 : 该问题无法复现。
rule: Q1=yes & Q2=yes & Q4=yes & Q6=yes -> 严重 : 任何人都能在没有受害者操作的情况下永久窃取资金。
rule: Q2=yes & Q6=yes -> 高危 : 资金可能被永久损失，但攻击需要特殊角色或受害者的操作。
rule: Q2=yes -> 中危 : 资金可能损失，但损失可以逆转。
rule: Q6=yes -> 中危 : 造成永久性损害，但没有资金损失。
default: 低危 : 可以复现且在范围内，但没有资金损失，也没有永久性损害。
`}},
    {key: "warranty",
      en: {chip: "Warranty example", title: "Warranty claim", blurb: "Is a repair covered by the warranty?", text: null},
      zh: {chip: "保修示例", title: "保修理赔", blurb: "维修是否在保修范围内？", text: `name: 保修理赔
about: 在提交理赔之前，先查明维修是否在保修范围内。
question: 产品是否已登记，或者你能否出示购买凭证？ | 登记号或收据
question: 是否仍在保修期内？ | 购买日期
question: 是否从授权卖家处购买？ | 收据上的卖家名称
question: 此类损坏或故障是否属于保修范围？ | 故障描述和照片
question: 是否不存在免责原因，例如进水、摔落或未经授权的维修？ | 维修中心检测记录
question: 产品是否未超出使用限制？ | 使用读数或使用时长
question: 你需要的维修是否属于保修范围？ | 维修中心报价
result: 不予保修
result: 需要复核
result: 部分保修（零件，不含人工）
result: 予以保修
rule: Q1=no -> 不予保修 : 产品未登记，也没有出示购买凭证。
rule: Q2=no -> 不予保修 : 保修期已结束。
rule: Q4=no -> 不予保修 : 这类损坏或故障不在保修范围内。
rule: Q5=no -> 不予保修 : 发现了免责原因（例如进水、摔落或未经授权的维修）。
rule: Q7=no -> 不予保修 : 这类维修不在保修范围内。
rule: Q3=no -> 需要复核 : 并非从授权卖家处购买，因此需要由人工查看。
rule: Q6=no -> 部分保修（零件，不含人工） : 已超出使用限制，因此零件在保修范围内，人工费用不在保修范围内。
default: 予以保修 : 保修的所有条件均已满足。
`}}
  ];

  // English text of warranty and bounty already lives in rules.js; the new templates are added to TB.TEMPLATES so every code path can find them.
  LIBRARY.forEach(t => { if (t.en.text === null) t.en.text = TB.TEMPLATES[t.key]; else TB.TEMPLATES[t.key] = t.en.text; });
  const find = key => LIBRARY.find(t => t.key === key);
  const lang = () => (root.TB_I18N && root.TB_I18N.lang) || "en";
  const published = key => !!(root.TB_CONFIG && root.TB_CONFIG.published && root.TB_CONFIG.published[key]);
  // The rules text to use for a template. `forCheck`: a checker page, where a PUBLISHED template must stay in English (its fingerprint is on-chain).
  function templateText(key, forCheck) {
    const t = find(key); if (!t) return TB.TEMPLATES[key];
    if (forCheck && published(key)) return t.en.text;
    return lang() === "zh" ? t.zh.text : t.en.text;
  }
  const info = key => { const t = find(key); return t ? (lang() === "zh" ? t.zh : t.en) : null; };
  TB.LIBRARY = LIBRARY; TB.templateText = templateText; TB.templateInfo = info;


  // ---------- a clause for the parties' written contract ----------
  // The legal effect of any of this comes from the parties' own written contract that points at the rules; LGtie records answers and applies the rules.
  // The clause says the outcome is an expert determination of questions of fact (binding) or advisory, never a court judgment or an arbitral award,
  // leaves the right to go to court or arbitration untouched, and tells the parties that the record is public. It is a template: a lawyer in the
  // parties' jurisdiction should review it. Pure, so it can be tested.
  // o: {key, effect: "binding" | "advisory", reviewer (text, optional), answerDays, reviewDays, link, hash (rules fingerprint, optional), published {ruleSetId, circuitId} (optional), name (optional), lang}
  function clause(o) {
    const zh = (o.lang || lang()) === "zh", i = find(o.key) ? (zh ? find(o.key).zh : find(o.key).en) : null, name = o.name || (i && i.title) || o.key;
    const A = o.answerDays || 7, R = o.reviewDays || 7, binding = o.effect !== "advisory", rv = (o.reviewer || "").trim();
    const fp = o.hash ? o.hash.slice(0, 18) + "…" : "", pub = o.published ? o.published : null;
    if (zh) return [
      `争议处理。如果双方对“${name}”是否适用存在分歧，双方将使用以下已公布的规则：${o.link}${fp ? `（规则指纹 ${fp}）` : ""}${pub ? `（X Layer 上的规则集 #${pub.ruleSetId}，电路 #${pub.circuitId}）` : ""}。`,
      `自收到书面争议通知之日起 ${A} 日内，双方各自回答规则中的同样问题。双方回答相同的问题，视为双方已经认可。`,
      `只有双方回答不一致的问题，才提交给${rv ? rv : "协议中指定的、或双方另行书面约定的"}中立人士。该人士是双方事先都接受的，只裁决这些问题，并在 ${R} 日内给出书面理由。随后由已公布的规则得出结果。`,
      binding ? `双方同意，该结果作为对这些事实问题的专家裁定对双方具有约束力，但不影响任何一方以欺诈、明显错误或缺乏公正性为由提出异议的权利。` : `该结果仅供参考。双方同意在提起诉讼或仲裁之前善意地考虑该结果，且该结果不妨碍任何一方采取其他任何措施。`,
      `本条款不限制任何一方就上述问题之外的事项提起诉讼或仲裁的权利。`,
      `所产生的记录用于证明各方回答了什么、裁定了什么。它不是法院判决，也不是仲裁裁决。`,
      `双方知悉，答案、证据指纹和审核人的书面理由会记录在公共区块链上，任何人都能看到。`
    ].join("\n\n");
    return [
      `Dispute process. If the parties disagree about whether "${name}" applies, they will use the published rules at ${o.link}${fp ? ` (rules fingerprint ${fp})` : ""}${pub ? ` (rule set #${pub.ruleSetId}, circuit #${pub.circuitId} on X Layer)` : ""}.`,
      `Within ${A} days of a written notice of dispute, each party answers the same questions in the rules. A question both parties answer the same way is treated as agreed.`,
      `Only the questions the parties answer differently go to ${rv ? rv : "the neutral person named in the agreement, or agreed by the parties in writing"}, a neutral person both parties have accepted in advance, who decides those questions only and gives written reasons within ${R} days. The published rules then give the outcome.`,
      binding ? `The parties agree to be bound by that outcome as an expert determination of those questions of fact, without prejudice to any right to challenge it for fraud, manifest error or lack of impartiality.` : `That outcome is advisory only. The parties agree to consider it in good faith before starting court or arbitration proceedings, and it does not prevent either of them from taking any other step.`,
      `This clause does not limit either party's right to go to court or to arbitration about anything outside those questions.`,
      `The record produced is evidence of what each party answered and what was decided. It is not a court judgment or an arbitral award.`,
      `The parties acknowledge that answers, fingerprints of evidence and the reviewer's written reasons are recorded on a public blockchain and can be seen by anyone.`
    ].join("\n\n");
  }

  const api = {LIBRARY, templateText, info, find, clause};
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  // ---------- the #templates page ----------
  const main = document.querySelector("#main"), esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const base = () => location.href.split("#")[0];
  const message = key => lang() === "zh"
    ? `在开始之前，我们能不能先约定好万一出问题怎么处理？这是我们双方都会回答的问题，以及决定结果的规则：${base()}#check/${key}\n如果将来有分歧，只有我们答案不一致的问题才会交给中立的第三方。你接受 LGtie 协议吗？`
    : `Before we go ahead, can we agree in advance what happens if something goes wrong? Here are the questions we would both answer, and the rules that decide the result: ${base()}#check/${key}\nIf we ever disagree, only the questions we answer differently go to a neutral person. Do you accept an LGtie agreement?`;

  // The clause card, used on the templates page (controls on the left, the clause on the right) and on an agreement page (the agreement's own
  // reviewer and time limits, so only the effect can be chosen). o: {key, fixed, reviewer, answerDays, reviewDays, link}
  const sha = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(x => x.toString(16).padStart(2, "0")).join("");
  const dayOpts = (n, list) => list.map(d => `<option value="${d}"${d === n ? " selected" : ""}>${d} days</option>`).join("");
  function clauseCard(el, o) {
    const fixed = !!o.fixed, uid = "cl" + Math.random().toString(36).slice(2, 7);
    el.innerHTML = `<h3>Put it in your contract</h3>
      <p class="small">The legal effect comes from your own written contract, not from LGtie. Paste a clause like this into it, so the contract itself says how a disagreement about the facts is settled. Have a lawyer in your jurisdiction review it: this is a template, not legal advice.</p>
      <div class="clause${fixed ? "" : " two"}">
        <div class="ctl">
          ${fixed ? "" : `<label>Rules<select id="${uid}k">${LIBRARY.map(t => `<option value="${t.key}"${t.key === o.key ? " selected" : ""}>${esc(info(t.key).title)}</option>`).join("")}</select></label>`}
          <label>The outcome is<select id="${uid}e"><option value="binding">Binding (expert determination)</option><option value="advisory">Advisory only</option></select></label>
          ${fixed ? "" : `<label>Neutral person (name, optional)<input id="${uid}r" type="text" placeholder="For example: Amina Yusuf" autocomplete="off"></label>
          <div class="two2"><label>To answer<select id="${uid}a">${dayOpts(o.answerDays || 7, [3, 7, 14, 30])}</select></label><label>For the neutral person<select id="${uid}d">${dayOpts(o.reviewDays || 7, [3, 7, 14, 30])}</select></label></div>`}
        </div>
        <div class="doc">
          <div class="dochead"><b>The clause</b><button class="btn small" id="${uid}c" type="button">Copy the clause</button></div>
          <textarea class="paper" id="${uid}t" rows="10" readonly aria-label="The clause"></textarea>
          <ul class="fine"><li>This does not limit anyone's right to go to court or to arbitration.</li><li>The record it produces is evidence of what each side answered and what was decided; it is not a court judgment or an arbitral award.</li><li>Answers, fingerprints of evidence and the reviewer's written reasons are public on the blockchain, so do not use LGtie for matters that must stay confidential.</li></ul>
        </div>
      </div>`;
    const $ = s => el.querySelector("#" + uid + s);
    const fit = () => { const t = $("t"); t.style.height = "auto"; t.style.height = (t.scrollHeight + 4) + "px"; };
    async function draw() {
      const key = fixed ? o.key : $("k").value, text = templateText(key, true), P = TB.parse(text).policy, pubd = published(key) ? root.TB_CONFIG.published[key] : null;
      const rvText = fixed ? o.reviewer : $("r").value;
      $("t").value = clause({key, effect: $("e").value, reviewer: rvText, answerDays: fixed ? o.answerDays : Number($("a").value), reviewDays: fixed ? o.reviewDays : Number($("d").value), link: o.link || (base() + "#check/" + key), hash: await sha(TB.canonical(P)), published: pubd});
      fit();
    }
    el.querySelectorAll("select,input").forEach(x => { x.oninput = draw; x.onchange = draw; });
    $("c").onclick = async () => { try { await navigator.clipboard.writeText($("t").value); const b = $("c"), t = b.textContent; b.textContent = "Copied"; setTimeout(() => b.textContent = t, 1400); } catch { $("t").select(); } };
    window.addEventListener("resize", () => { if (el.isConnected) fit(); });
    draw(); return {draw};
  }

  // small line icons, one per template
  const SHIELD = '<path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9-4-1.3-7-4.7-7-9V6l7-3z"/>';
  const ICON = {
    secondhand: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    freelance: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18"/>',
    rental: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    bounty: SHIELD + '<path d="M12 8.5v4M12 15.4v.1"/>',
    warranty: SHIELD + '<path d="M8.6 12l2.4 2.4 4.4-4.8"/>'
  };
  function page() {
    main.classList.add("tplpage");
    const rows = LIBRARY.map(t => {
      const i = info(t.key), n = TB.parse(templateText(t.key, true)).policy.questions.length, pub = published(t.key);
      return `<div class="card tpl"><div class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t.key] || SHIELD}</svg></div>
        <div class="txt"><h3>${esc(i.title)}</h3><p class="small">${esc(i.blurb)}</p><div class="meta"><span class="badge">${n} questions</span>${pub ? `<span class="badge ok">Published on X Layer</span>` : ""}</div></div>
        <div class="acts"><a class="btn small" href="#check/${t.key}">Try the checker</a><a class="btn small ghost" href="#build/${t.key}">Use in the builder</a><button class="btn small ghost" data-msg="${t.key}" type="button">Copy a message to send</button></div></div>`;
    }).join("");
    main.innerHTML = `<h1>Start from a template</h1><p class="lede">Pick a common situation, try its checker for free, then make the rules your own in the builder. Templates are starting points, not legal advice.</p>
      <div class="tpllist">${rows}</div>
      <div class="note">Trying a checker is free and needs no wallet. To use a template in an agreement or a case on X Layer, its rules have to be published first, which costs a small fee. Only the warranty rules are published today.</div>
      <h2 class="sech">Before you pay, ask for it</h2>
      <div class="duo"><div><h4>Buying or hiring</h4><p class="small">Ask first: "Will you accept an LGtie agreement?" If they will not agree the refund rules before you pay, you have learned something. If they will, you both know what happens if it goes wrong.</p></div>
        <div><h4>Selling or providing</h4><p class="small">Show the rules first. The receipt of a decided case shows which rules both sides agreed and who settled each question. It is useful supporting evidence if a payment company or a platform asks, but they decide what they accept.</p></div></div>
      <div class="card" id="clausecard"></div>`;
    clauseCard(main.querySelector("#clausecard"), {key: "freelance"});
    main.querySelectorAll("[data-msg]").forEach(b => b.onclick = async () => { const t = message(b.dataset.msg); try { await navigator.clipboard.writeText(t); const o = b.textContent; b.textContent = "Copied"; setTimeout(() => b.textContent = o, 1400); } catch { prompt("Copy:", t); } });
  }
  root.TB_TEMPLATES = Object.assign(api, {page, clauseCard});
})(typeof window !== "undefined" ? window : globalThis);
