// YouTube (MAIN world): player tak pahunchne se pehle hi ad ki jaankari data se hata deta hai.
// Isse ad break banta hi nahi — skip karne ki zaroorat hi nahi padti.
(() => {
  if (window.__vabYT) return;
  Object.defineProperty(window, "__vabYT", { value: true });

  // ye keys hatane se video ads (pre-roll, mid-roll, post-roll) khatam
  const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams", "adBreakParams"];
  // feed / search / shorts mein ye items ads hote hain
  const AD_ITEMS = [
    "adSlotRenderer", "promotedSparklesWebRenderer", "promotedVideoRenderer", "displayAdRenderer",
    "compactPromotedVideoRenderer", "searchPyvRenderer", "bannerPromoRenderer", "statementBannerRenderer",
    "inFeedAdLayoutRenderer", "promotedSparklesTextSearchRenderer", "adBreakServiceRenderer",
    "reelAdRenderer", "adActionInterstitialRenderer", "mealbarPromoRenderer", "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
  ];
  const AD_SET = new Set(AD_ITEMS);
  const HINT = /adPlacements|playerAds|adSlots|adSlotRenderer|promotedSparkles|promotedVideoRenderer|displayAdRenderer|searchPyvRenderer|bannerPromoRenderer|statementBannerRenderer|inFeedAdLayoutRenderer|reelAdRenderer|adBreak/;

  let removed = 0;
  function isAdItem(item) {
    if (!item || typeof item !== "object") return false;
    for (const k in item) {
      if (AD_SET.has(k)) return true;
      // richItemRenderer.content.adSlotRenderer, richSectionRenderer.content... jaise wrapper
      const v = item[k];
      if (v && typeof v === "object" && v.content && typeof v.content === "object") {
        for (const k2 in v.content) if (AD_SET.has(k2)) return true;
      }
    }
    // shorts ka ad
    if (item.command && item.command.reelWatchEndpoint && item.command.reelWatchEndpoint.adClientParams) return true;
    return false;
  }

  function prune(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 40) return obj;
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (isAdItem(obj[i])) { obj.splice(i, 1); removed++; }
        else prune(obj[i], depth + 1);
      }
      return obj;
    }
    for (const k of AD_KEYS) {
      if (k in obj) { delete obj[k]; removed++; }
    }
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === "object") prune(v, depth + 1);
    }
    return obj;
  }
  window.__vabPrune = prune; // test ke liye

  // 1) page load ke time ka data: ytInitialPlayerResponse / ytInitialData
  for (const name of ["ytInitialPlayerResponse", "ytInitialData", "playerResponse"]) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => { value = prune(v); },
      });
    } catch (_) {}
  }

  // 2) JSON.parse se aane wala data
  const realParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const out = realParse.call(this, text, reviver);
    try {
      if (typeof text === "string" && text.length > 50 && HINT.test(text)) prune(out);
    } catch (_) {}
    return out;
  };
  Object.defineProperty(JSON.parse, "toString", { value: () => realParse.toString() });

  // 3) fetch se aane wala data (video kholne, next video, shorts, feed)
  const API = /\/youtubei\/v1\/(player|next|browse|search|reel|guide)/;
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await realFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (!API.test(url) || !res.ok) return res;
      const text = await res.clone().text();
      if (!HINT.test(text)) return res;
      const data = prune(realParse(text));
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      const out = new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers });
      Object.defineProperty(out, "url", { value: res.url });
      return out;
    } catch (_) {
      return res;
    }
  };
  Object.defineProperty(window.fetch, "toString", { value: () => realFetch.toString() });

  // 4) XHR (mobile YouTube kabhi kabhi XHR use karta hai)
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vabUrl = String(url || "");
    return xhrOpen.apply(this, arguments);
  };
  const desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
  if (desc && desc.get) {
    Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
      configurable: true,
      get() {
        const text = desc.get.call(this);
        try {
          if (this.__vabUrl && API.test(this.__vabUrl) && this.readyState === 4 && HINT.test(text)) {
            if (this.__vabSrc !== text) {
              this.__vabSrc = text;
              this.__vabOut = JSON.stringify(prune(realParse(text)));
            }
            return this.__vabOut;
          }
        } catch (_) {}
        return text;
      },
    });
  }
})();
