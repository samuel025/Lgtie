// Tiebreak embed: add <div></div><script src=".../embed.js" data-checker="warranty" async></script> where the checker should appear.
// data-checker is a built-in name (warranty, bounty) or a published spec such as "c=<rules>/rs=<number>". Static: it only adds an iframe.
(function () {
  "use strict";
  var s = document.currentScript; if (!s || !s.src) return;
  var spec = s.getAttribute("data-checker") || "warranty", page = s.getAttribute("data-page") || "index.html";
  var f = document.createElement("iframe");
  f.src = s.src.replace(/[^\/?#]*([?#].*)?$/, "") + page + "#embed/" + spec;
  f.title = s.getAttribute("data-title") || "Tiebreak checker"; f.loading = "lazy";
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  f.style.cssText = "width:100%;border:0;display:block;min-height:" + (s.getAttribute("data-min-height") || "420") + "px;background:transparent";
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener("message", function (e) {
    if (e.source !== f.contentWindow || !e.data || e.data.tiebreak !== "height") return;
    var h = Number(e.data.h); if (h > 100 && h < 6000) f.style.height = Math.ceil(h) + "px";
  });
})();
