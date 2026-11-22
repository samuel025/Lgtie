// node scripts/bundle.mjs  ->  dist/index.html (one self-contained file: all scripts inlined, no external assets), plus embed.js and embed-demo.html.
// Static only, so the same files can be served by any static host or published later on DeWEB.
import {readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync} from "node:fs";
import {fileURLToPath} from "node:url"; import {dirname, join} from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site"), out = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
mkdirSync(out, {recursive: true});
let html = readFileSync(join(root, "index.html"), "utf8"), n = 0;
html = html.replace(/<script src="([a-z-]+\.js)"><\/script>/g, (m, f) => { n++; const js = readFileSync(join(root, f), "utf8").replace(/<\/script/gi, "<\\/script"); return `<script>/* ${f} */\n${js}\n</script>`; });
const page = readFileSync(join(root, "index.html"), "utf8"); // the page's own markup, before inlining
if (/(src|href)="https?:\/\//i.test(page.replace(/<a [^>]*>/g, "")) || /<link rel="stylesheet"|@import|url\(\s*["']?https?:/i.test(page)) { console.error("The page loads an external asset; refusing, so the bundle stays self-contained."); process.exit(1); }
writeFileSync(join(out, "index.html"), html);
for (const f of ["embed.js", "embed-demo.html"]) copyFileSync(join(root, f), join(out, f));
console.log(`dist/index.html: ${n} scripts inlined, ${(statSync(join(out, "index.html")).size / 1024).toFixed(1)} KB. Also dist/embed.js and dist/embed-demo.html.`);
