// Writes dist/deal/<template>.html: one small static page per template. Chat apps (WhatsApp, Telegram, Discord) read a link's preview card from
// the page's own <meta> tags and ignore everything after the #, so this page carries the title, text and picture for the template. A person who
// opens the link lands here, and a script sends them straight on to the app with the deal details (which stay after the # and are never sent anywhere).
// Used by scripts/bundle.mjs. Pictures: site/og/<template>.png (scripts/make-og.mjs). SITE_ORIGIN sets the address used in the preview.
import {mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
const require = createRequire(import.meta.url);
export function writeDealPages(root, out, origin = process.env.SITE_ORIGIN || "https://lgtie.vercel.app") {
  const TB = require(join(root, "rules.js")), T = require(join(root, "templates.js")), esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  mkdirSync(join(out, "deal"), {recursive: true}); mkdirSync(join(out, "og"), {recursive: true});
  let n = 0;
  for (const t of T.LIBRARY) {
    const i = T.info(t.key), q = TB.parse(T.templateText(t.key, true)).policy.questions.length;
    const title = `${i.title}: agree the rules before any money moves`, desc = `${i.blurb} ${q} yes/no questions. Tap to read them. No wallet needed.`, img = `${origin}/og/${t.key}.png`, url = `${origin}/deal/${t.key}.html`;
    writeFileSync(join(out, "deal", t.key + ".html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:site_name" content="LGtie"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(i.title)} on LGtie">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<noscript><meta http-equiv="refresh" content="0;url=../index.html#deal/${t.key}"></noscript>
<script>var h=location.hash.slice(1);location.replace("../index.html#"+(h?"d/"+h:"deal/${t.key}"));</script></head>
<body style="font-family:system-ui,sans-serif;padding:32px"><p>Opening LGtie… <a href="../index.html#deal/${t.key}">Continue</a></p></body></html>
`);
    n++;
  }
  const og = join(root, "og");
  if (existsSync(og)) for (const f of readdirSync(og)) if (f.endsWith(".png")) copyFileSync(join(og, f), join(out, "og", f));
  return n;
}
