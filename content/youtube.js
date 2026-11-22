// YouTube: video ads ko turant skip/khatam karta hai aur ad slots chhupata hai.
(async () => {
  let allowed = false;
  try {
    const r = await chrome.runtime.sendMessage({ type: "youtubeAllowed" });
    allowed = r && r.ok;
  } catch (_) {}
  if (!allowed) return;

  const HIDE = [
    "#masthead-ad", "#player-ads", "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer", "ytd-promoted-sparkles-web-renderer", "ytd-promoted-video-renderer",
    "ytd-display-ad-renderer", "ytd-compact-promoted-video-renderer", "ytd-statement-banner-renderer",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
    "ytd-search-pyv-renderer", "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    ".ytp-ad-overlay-container", ".ytp-ad-overlay-slot", ".ytd-merch-shelf-renderer", "ytm-promoted-sparkles-web-renderer",
    "ad-slot-renderer", "ytm-companion-ad-renderer", "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-reel-video-renderer:has(ytd-ad-slot-renderer)", "ytd-reel-video-renderer:has(.ytd-ad-slot-renderer)",
    "ytm-reel-item-renderer:has(ad-slot-renderer)", "#shorts-inner-container ytd-ad-slot-renderer",
    "ytd-rich-shelf-renderer:has(ytd-ad-slot-renderer)", "ytd-merch-shelf-renderer", "ytd-ticket-shelf-renderer",
    ".ytd-player-legacy-desktop-watch-ads-renderer", "#panels ytd-ads-engagement-panel-content-renderer",
    "ytd-enforcement-message-view-model", "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    ".ytp-ad-module", ".ytp-ad-image-overlay", ".ytp-ad-text-overlay", ".ytp-featured-product",
    "ytd-companion-slot-renderer", "#related ytd-ad-slot-renderer", "yt-mealbar-promo-renderer",
  ];
  const style = document.createElement("style");
  style.textContent = HIDE.join(",\n") + "{display:none!important}";
  (document.head || document.documentElement).appendChild(style);

  const SKIP = [
    ".ytp-skip-ad-button", ".ytp-ad-skip-button", ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button", "button[id^='skip-button']", ".videoAdUiSkipButton",
  ].join(",");

  let inAd = false;
  let mutedByUs = false;

  // "Ad blockers are not allowed" wala popup hatao aur video chalu karo
  function killEnforcement() {
    const msg = document.querySelector("ytd-enforcement-message-view-model");
    if (!msg) return;
    const dialog = msg.closest("tp-yt-paper-dialog") || msg;
    dialog.remove();
    document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => b.remove());
    document.body && (document.body.style.overflow = "");
    const v = document.querySelector(".html5-video-player video");
    if (v && v.paused) v.play().catch(() => {});
  }

  // Shorts mein ad aaye to agla short
  let lastShortAd = null;
  function skipShortAd() {
    if (!location.pathname.startsWith("/shorts")) return;
    const active = document.querySelector("ytd-reel-video-renderer[is-active]");
    if (active && active !== lastShortAd && active.querySelector("ytd-ad-slot-renderer, .ytd-ad-slot-renderer, ad-slot-renderer")) {
      lastShortAd = active;
      const next = document.querySelector("#navigation-button-down button, .navigation-button-down button");
      if (next) next.click();
      chrome.runtime.sendMessage({ type: "youtubeSkipped" }).catch(() => {});
    }
  }

  function check() {
    killEnforcement();
    skipShortAd();
    const player = document.querySelector(".html5-video-player");
    if (!player) return;
    const video = player.querySelector("video");
    const adNow = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");

    if (adNow) {
      if (!inAd) {
        inAd = true;
        chrome.runtime.sendMessage({ type: "youtubeSkipped" }).catch(() => {});
      }
      if (video) {
        if (!video.muted) { video.muted = true; mutedByUs = true; }
        // sirf chhote ad clip ko aage badhao (server-side ad mein lamba stream hota hai, wahan sirf speed)
        if (isFinite(video.duration) && video.duration > 0 && video.duration < 180 && video.currentTime < video.duration - 0.2) {
          video.currentTime = video.duration - 0.1;
        }
        video.playbackRate = 16;
      }
      document.querySelectorAll(SKIP).forEach((b) => b.click());
    } else if (inAd) {
      inAd = false;
      if (video) {
        video.playbackRate = 1;
        if (mutedByUs) { video.muted = false; mutedByUs = false; }
      }
    }
  }

  // player ki class badalte hi check karo (halka observer), saath mein backup timer
  let watched = null;
  const obs = new MutationObserver(check);
  setInterval(() => {
    const player = document.querySelector(".html5-video-player");
    if (player && player !== watched) {
      obs.disconnect();
      obs.observe(player, { attributes: true, attributeFilter: ["class"] });
      watched = player;
    }
    check();
  }, 250);
})();
