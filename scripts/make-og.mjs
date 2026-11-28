// Makes the preview picture for each template: site/og/<template>.png, 1200x630. Run from a folder where puppeteer-core is installed:
//   node scripts/make-og.mjs      (needs Chrome or Chromium)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url), ROOT = new URL("../site/", import.meta.url).pathname;
const TB = require(ROOT + "rules.js"), T = require(ROOT + "templates.js");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
fs.mkdirSync(ROOT + "og", {recursive: true});
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage(); await p.setViewport({width: 1200, height: 630});
const esc = s => String(s).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
for (const t of T.LIBRARY) {
  const i = T.info(t.key), q = TB.parse(T.templateText(t.key, true)).policy.questions.length;
  await p.setContent(`<body style="margin:0;width:1200px;height:630px;background:#f2f1ed;font-family:Inter,Arial,Helvetica,sans-serif;color:#000;display:flex;flex-direction:column;justify-content:space-between;padding:64px 72px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:18px"><svg width="64" height="64" viewBox="0 0 24 24"><rect width="24" height="24" rx="7" fill="#111"/><path d="M6.5 6.5h5a5.5 5.5 0 010 11h-5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><circle cx="19.2" cy="12" r="1.5" fill="none" stroke="#fff" stroke-width="1.5"/></svg><b style="font-size:40px">LGtie</b></div>
    <div><div style="font-size:84px;line-height:1.02;font-weight:800;letter-spacing:-2px;max-width:1000px">${esc(i.title)}</div>
      <div style="font-size:42px;margin-top:22px;color:#444;max-width:980px">Agree the rules before any money moves.</div></div>
    <div style="display:flex;gap:16px;align-items:center"><span style="background:#ff5b2e;color:#fff;font-size:32px;font-weight:700;padding:12px 26px;border-radius:999px">${q} yes/no questions</span><span style="font-size:32px;color:#444">Tap to read them. No wallet needed.</span></div></body>`);
  await p.screenshot({path: ROOT + "og/" + t.key + ".png"}); console.log("og/" + t.key + ".png");
}
await b.close();
