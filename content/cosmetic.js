// Har page/frame par: background se is site ke liye CSS lagwata hai (ads chhupane ke liye)
(() => {
  if (window.__vabCosmetic) return;
  window.__vabCosmetic = true;
  let host = location.hostname;
  if (!host && window !== top) {
    try { host = top.location.hostname; } catch (_) {}
  }
  if (!host) return;
  chrome.runtime.sendMessage({ type: "cosmetic", host }).catch(() => {});

  // main-world.js ne popup roka to stats mein gino
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__vab === "popupBlocked") {
      chrome.runtime.sendMessage({ type: "popupBlocked" }).catch(() => {});
    }
  });
})();
