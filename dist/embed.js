// LGtie embed. Put <div></div><script src=".../embed.js" data-checker="warranty" async></script> where the checker should appear.
//   data-checker  a built-in name (warranty, bounty) or a published spec such as "c=<rules>/rs=<number>"
//   data-flow     "join" lets a customer create a passkey (no wallet); the page then receives a claim code (see data-onclaim).
//                 "mine" shows that customer's own agreements and cases, where they sign with the passkey.
//   data-onclaim  the name of a global function called with the claim code, e.g. data-onclaim="saveClaim". The host should store the code
//                 with the logged-in customer's account on its own server. The code is public information, not a secret.
// Static: it only adds an iframe and relays two messages. It checks the sender's origin before trusting a message.
(function () {
  "use strict";
  var s = document.currentScript; if (!s || !s.src) return;
  var flow = s.getAttribute("data-flow"), spec = s.getAttribute("data-checker") || "warranty", page = s.getAttribute("data-page") || "index.html";
  var f = document.createElement("iframe");
  f.src = s.src.replace(/[^\/?#]*([?#].*)?$/, "") + page + "#embed/" + (flow === "join" || flow === "mine" ? flow : spec);
  f.title = s.getAttribute("data-title") || (flow === "join" ? "Create a passkey" : flow === "mine" ? "My cases" : "LGtie checker"); f.loading = "lazy";
  f.setAttribute("allow", "publickey-credentials-create *; publickey-credentials-get *");   // passkeys inside a frame need this permission
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  f.style.cssText = "width:100%;border:0;display:block;min-height:" + (s.getAttribute("data-min-height") || "420") + "px;background:transparent";
  s.parentNode.insertBefore(f, s.nextSibling);
  var origin = new URL(f.src, location.href).origin;
  window.addEventListener("message", function (e) {
    if (e.source !== f.contentWindow || e.origin !== origin || !e.data || typeof e.data !== "object") return;
    if (e.data.lgtie === "height") { var h = Number(e.data.h); if (h > 100 && h < 6000) f.style.height = Math.ceil(h) + "px"; }
    else if (e.data.lgtie === "passkey-claim" && typeof e.data.claim === "string" && /^lgtie1\.[A-Za-z0-9_-]{20,2000}$/.test(e.data.claim)) {
      var cb = s.getAttribute("data-onclaim"); if (cb && typeof window[cb] === "function") window[cb](e.data.claim);
      window.dispatchEvent(new CustomEvent("lgtie:claim", {detail: {claim: e.data.claim}}));
    }
  });
})();
