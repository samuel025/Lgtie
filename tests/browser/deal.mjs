// Deal links: the creator's form and share buttons, the page the other person opens, hostile link text, the static preview pages chat apps read, and
// the invite flow they fill in. Needs the site on http://localhost:8090 (site/) and the built pages on http://localhost:8095 (dist/, run scripts/bundle.mjs).
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html", DIST = process.env.DIST || "http://localhost:8095";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
async function page(lang = "en") { const p = await b.newPage(); await p.setViewport({width: 1100, height: 1400}); p.on("pageerror", e => errs.push(e.message)); await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p; }
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(250); } return false; };
const type = async (p, sel, v) => { await p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input")); }, v); };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");

// ---- the creator
const c = await page(); await c.goto(BASE + "#templates");
ok("every template card offers 'Create deal link'", await until(async () => (await c.$$('.tpl a[href^="#deal/"]')).length === 5), await T(c, "main"));
await c.goto(BASE + "#deal/secondhand");
ok("the creator page opens with the template's question count", await until(async () => /5 yes\/no questions/.test(await T(c, "main"))), await T(c, "main"));
ok("where signed cards are available but the rules are not published, the box turns itself off with a reason and an ordinary link is made", !(await c.$("#dl-card")) || (await c.$eval("#dl-card", e => e.disabled && !e.checked) && /Not available for these rules/.test(await T(c, "#dl-cardnote")) && !!(await c.$("#dl-msg"))), await T(c, "main"));
await type(c, "#dl-a", "Samuel"); await type(c, "#dl-b", "Amina"); await type(c, "#dl-w", "iPhone 12, 128GB, blue"); await type(c, "#dl-p", "₦250,000"); await type(c, "#dl-v", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"); await c.$eval("#dl-d", e => { e.value = "2030-01-31"; e.dispatchEvent(new Event("input")); });
const msg = await c.$eval("#dl-msg", e => e.value);
ok("the message names the sender, the thing, the price and the date, and ends with the link", /Samuel invited you/.test(msg) && /iPhone 12/.test(msg) && /₦250,000/.test(msg) && /2030-01-31/.test(msg) && /\/deal\/secondhand\.html#/.test(msg.split("\n").pop()), msg);
ok("it says no wallet is needed and that only disagreements go to a neutral person", /No wallet needed/.test(msg) && /neutral person/.test(msg));
const wa = await c.$eval("#dl-wa", a => a.href), tg = await c.$eval("#dl-tg", a => a.href);
ok("the WhatsApp button carries the whole message", wa.startsWith("https://wa.me/?text=") && decodeURIComponent(wa.slice(20)) === msg, wa);
ok("the Telegram button carries the link and the text", tg.startsWith("https://t.me/share/url?url=") && /deal%2Fsecondhand\.html%23/.test(tg) && /Samuel%20invited%20you/.test(tg), tg);
ok("an email link is offered too", (await c.$eval("#dl-em", a => a.href)).startsWith("mailto:?subject="));
ok("it explains that the details live after the # and who can read them", /after the #/.test(await T(c, "#dl-out")) && /Anyone who gets the link can read them/.test(await T(c, "#dl-out")));
await c.$eval("#dl-msg", e => { e.value = e.value + "\nSee you soon"; e.dispatchEvent(new Event("input")); });
ok("editing the message updates the share links", decodeURIComponent((await c.$eval("#dl-wa", a => a.href)).slice(20)).endsWith("See you soon"));
const link = msg.split("\n").pop(), payload = link.split("#")[1];
const dec = JSON.parse(Buffer.from(payload, "base64url").toString());
ok("the link holds the details as plain fields and nothing else", dec.t === "secondhand" && dec.a === "Samuel" && dec.b === "Amina" && dec.w === "iPhone 12, 128GB, blue" && dec.p === "₦250,000" && dec.d === "2030-01-31" && dec.v === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" && !("r" in dec), JSON.stringify(dec));
await c.$eval("#dl-t", e => { e.value = "freelance"; e.dispatchEvent(new Event("change")); });
ok("choosing another situation switches the page", await until(async () => /Freelance milestone/.test(await T(c, "#dl-out")) && /4 yes\/no questions/.test(await T(c, "main"))));

// ---- the other person
const o = await page(); await o.goto(BASE + "#d/" + payload);
ok("the deal page names who sent it and the item", await until(async () => { const t = await T(o, "main"); return /Samuel wants to agree the rules first/.test(t) && /iPhone 12/.test(t) && /₦250,000/.test(t); }), await T(o, "main"));
ok("it lists the five questions", (await o.$$("main ol")).length >= 1 && (await o.$$eval("main .card:nth-of-type(2) li", l => l.length)) === 5, await T(o, "main"));
ok("it links to the free checker and offers one button to agree with a passkey", (await o.$eval('a[href="#check/secondhand"]', a => a.textContent)).length > 0 && /Agree with my passkey/.test(await T(o, "#dd-go")));
ok("the free part comes before the agreement step", /Read it first \(free, no wallet\)/.test(await T(o, "main")) && (await o.$eval("#dd-agree", e => e.previousElementSibling.innerText)).includes("Read it first"));
ok("it says plainly it is not binding until accepted on X Layer, and not legal advice", /Not binding by itself/.test(await T(o, "main")) && /not a court/.test(await T(o, "main")));
ok("a reviewer named by the sender is shown, abbreviated, with who named it", /Reviewer\s+0x709979…[0-9a-fA-F]{6}[\s\S]*named by Samuel/.test(await T(o, "main")), await T(o, "main"));
ok("it shows a fingerprint of the terms", /Fingerprint of these terms: 0x[0-9a-f]{16}/.test(await T(o, "main")));
ok("secondhand rules are not published, so the creator is told to publish first and cannot invite yet", /not published on X Layer yet/.test(await T(o, "main")) && !(await o.$("#dd-inv")));

// ---- the recipient agrees in one tap, and the sender's link opens the invite already filled in
const rp = await page(), cdp = await rp.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
await rp.goto(BASE + "#d/" + b64({t: "warranty", a: "Samuel", b: "Amina", w: "Laptop repair", v: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"})); await w(1200);
await rp.click("#dd-go");
ok("one tap makes the passkey and gives a reply ready to send", await until(async () => /^This is Amina\. I agree to the rules for Laptop repair\./.test(await rp.$eval("#dd-msg", e => e.value).catch(() => ""))), await T(rp, "#dd-out"));
const reply = await rp.$eval("#dd-msg", e => e.value), rlink = reply.split(": ").pop();
ok("the reply's link carries the passkey code and the deal details", /#pk\/agree\/lgtie1\.[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(rlink), rlink);
ok("it offers WhatsApp, Telegram and copy, and says what to do next", (await rp.$eval("#dd-share a:nth-child(1)", a => a.href)).startsWith("https://wa.me/?text=") && (await rp.$eval("#dd-share a:nth-child(2)", a => a.href)).startsWith("https://t.me/share/url?url=") && /open My cases/.test(await T(rp, "#dd-out")) && /Samuel/.test(await T(rp, "#dd-out")));
ok("the claim code in the reply never contains a private key (it is a public key only)", !/private|"d":/.test(Buffer.from(rlink.split("/")[0].split("lgtie1.")[1] || "", "base64url").toString()));
const snd = await page(); await snd.goto(rlink);
ok("the sender taps it and the invite page is already filled in: claim code, terms and rule set", await until(async () => /^lgtie1\./.test(await snd.$eval("#cc", e => e.value).catch(() => "")) && /LGtie deal/.test(await snd.$eval("#terms", e => e.value).catch(() => "")) && /Laptop repair/.test(await snd.$eval("#terms", e => e.value).catch(() => "")) && (await snd.$eval("#rs", e => e.value).catch(() => "")) === "1"), await T(snd, "main"));
ok("the reviewer the sender named is already in the invite page, so there is nothing to type", (await snd.$eval("#rv", e => e.value).catch(() => "")) === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" && /Reviewer: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8/.test(await snd.$eval("#terms", e => e.value).catch(() => "")));
ok("and it says where this came from", /From a deal link: Amina agreed to the rules for Laptop repair/.test(await T(snd, "main")));
await rp.reload(); await w(1500); await rp.evaluate(() => document.querySelector("#dd-go").click());   // a DOM click: a mouse click right after a reload can stall in this browser build
ok("tapping again on the same phone reuses the passkey instead of making another", await until(async () => /Using the passkey already on this phone/.test(await T(rp, "#dd-out"))), await T(rp, "#dd-out"));

// ---- hostile and broken links
const h = await page(); await h.goto(BASE + "#d/" + b64({t: "secondhand", a: '<img src=x onerror="window.__pwn=1">', w: "<b>bold</b>", p: "x".repeat(500), d: "not a date", r: -5, v: "0xnot-an-address"}));
await w(1500);
ok("text in a link is shown as text, never run or rendered", !(await h.$("main img")) && !(await h.$("main b + b")) && !(await h.evaluate(() => window.__pwn)) && /<img src=x/.test(await T(h, "main")), await T(h, "main"));
ok("long values are cut and a bad date or rule number is dropped", !/x{100}/.test(await T(h, "main")) && !/not a date/.test(await T(h, "main")) && !/not-an-address/.test(await T(h, "main")));
const bad = await page(); await bad.goto(BASE + "#d/%%%not-base64");
ok("a broken link says so and offers the templates", await until(async () => /not valid/.test(await T(bad, "main")) && !!(await bad.$('a[href="#templates"]'))), await T(bad, "main"));
await bad.goto(BASE + "#d/" + b64({t: "../../etc", a: "x"}));
ok("an unknown template in a link is refused", await until(async () => /does not have/.test(await T(bad, "main"))), await T(bad, "main"));

// ---- a published rule set: the creator can invite, with the terms and rule filled in
const pub = await page(); await pub.goto(BASE + "#d/" + b64({t: "warranty", a: "Samuel", w: "Laptop repair"}));
ok("warranty rules are published, so the creator can invite by passkey", await until(async () => !!(await pub.$("#dd-inv"))), await T(pub, "main"));
await pub.click("#dd-inv");
ok("the invite page opens with the deal terms and the rule set filled in", await until(async () => /LGtie deal/.test(await pub.$eval("#terms", e => e.value).catch(() => "")) && (await pub.$eval("#rs", e => e.value).catch(() => "")) === "1"), await pub.$eval("#terms", e => e.value).catch(() => "none"));
const custom = await page(); await custom.goto(BASE + "#d/" + b64({t: "freelance", a: "Samuel", r: 7}));
await until(async () => !!(await custom.$("#dd-inv"))); await custom.click("#dd-inv");
ok("a rule set number in the link is offered and chosen on the invite page", await until(async () => (await custom.$eval("#rs", e => e.value).catch(() => "")) === "7"), await custom.$eval("#rs", e => e.outerHTML).catch(() => "none"));

// ---- Chinese message
const z = await page("zh"); await z.goto(BASE + "#deal/freelance");
await until(async () => !!(await z.$("#dl-msg"))); await type(z, "#dl-a", "Samuel");
ok("the Chinese message is in Chinese and ends with the link", /邀请你/.test(await z.$eval("#dl-msg", e => e.value)) && /\/deal\/freelance\.html#/.test((await z.$eval("#dl-msg", e => e.value)).split("\n").pop()));

// ---- the static preview pages chat apps read (built into dist/)
const html = await (await fetch(DIST + "/deal/freelance.html")).text();
ok("the preview page has its own title, description and a picture of the right size", /<meta property="og:title" content="Freelance milestone: agree the rules before any money moves">/.test(html) && /og:description" content="[^"]*4 yes\/no questions/.test(html) && /og:image" content="https:\/\/[^"]+\/og\/freelance\.png"/.test(html) && /og:image:width" content="1200"/.test(html) && /twitter:card" content="summary_large_image"/.test(html), html.slice(0, 600));
ok("it never contains the deal details (a chat app could not see them anyway)", !/Samuel/.test(html));
const img = await fetch(DIST + "/og/freelance.png"), buf = Buffer.from(await img.arrayBuffer());
ok("the picture is a PNG of 1200x630 under 300 KB", img.status === 200 && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630 && buf.length < 300000, img.status + " " + buf.length);
const lp = await page(); await lp.goto(DIST + "/deal/freelance.html#" + b64({t: "freelance", a: "Samuel", w: "Logo design"}));
ok("opening the shared link lands in the app on the deal page with the details", await until(async () => /index\.html#d\//.test(lp.url()) && /Samuel wants to agree the rules first/.test(await T(lp, "main"))), lp.url());
const lp2 = await page(); await lp2.goto(DIST + "/deal/freelance.html");
ok("the same page without details opens the creator form", await until(async () => /#deal\/freelance/.test(lp2.url()) && /Create a deal link/.test(await T(lp2, "main"))), lp2.url());
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
