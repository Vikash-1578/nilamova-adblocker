/* Nilamova Ad Blocker — background service worker */
importScripts("config.js");

const CATEGORIES = ["ads", "privacy", "annoyances", "antiadblock", "malware"];
const DEFAULTS = {
  enabled: true,
  whitelist: [],
  categories: { ads: true, privacy: true, annoyances: true, antiadblock: true, malware: true },
  popupBlock: true,
  youtube: true,
  lang: "auto",
  custom: {},              // host -> [selectors] (element picker se)
  stats: { total: 0, popups: 0, youtube: 0, since: Date.now() },
};
const ALLOW_ID_START = 500000;
const WHITELIST_ID_START = 1;
const MAIN_SCRIPT_ID = "vab-main-guard";
const YT_SCRIPT_ID = "vab-yt-main";

/* ---------- settings ---------- */
async function getSettings() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = s[k] === undefined ? structuredClone(DEFAULTS[k]) : s[k];
  }
  out.categories = { ...DEFAULTS.categories, ...out.categories };
  return out;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function parentDomains(host) {
  if (!host) return [];
  const parts = host.split(".");
  const res = [host];
  for (let i = 1; i < parts.length - 1; i++) res.push(parts.slice(i).join("."));
  return res;
}
function isWhitelisted(settings, host) {
  if (!host) return false;
  const all = parentDomains(host);
  return settings.whitelist.some((w) => all.includes(w));
}

/* ---------- apply settings to Chrome ---------- */
let applying = Promise.resolve();
function applySettings() {
  applying = applying.then(doApply).catch((e) => console.warn("apply failed", e));
  return applying;
}

async function doApply() {
  const s = await getSettings();

  // 1. rulesets on/off
  const enable = [], disable = [];
  for (const c of CATEGORIES) (s.enabled && s.categories[c] ? enable : disable).push(c);
  (s.enabled && s.youtube ? enable : disable).push("youtube");
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enable, disableRulesetIds: disable,
  });

  // 2. whitelist -> dynamic allowAllRequests rules
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = s.whitelist.map((host, i) => ({
    id: WHITELIST_ID_START + i,
    priority: 1000,
    action: { type: "allowAllRequests" },
    condition: { requestDomains: [host], resourceTypes: ["main_frame", "sub_frame"] },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id), addRules,
  });

  // 3. MAIN world popup guard
  const existing = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id);
  const toRemove = [MAIN_SCRIPT_ID, YT_SCRIPT_ID].filter((id) => existing.includes(id));
  if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  // YouTube ad data hatane wala script (sabse pehle chalna chahiye)
  if (s.enabled && s.youtube && !isWhitelisted(s, "youtube.com")) {
    await chrome.scripting.registerContentScripts([{
      id: YT_SCRIPT_ID,
      matches: ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://music.youtube.com/*",
                "https://www.youtube-nocookie.com/*"],
      js: ["content/youtube-main.js"],
      runAt: "document_start",
      allFrames: true,
      world: "MAIN",
      persistAcrossSessions: true,
    }]);
  }
  if (s.enabled && s.popupBlock) {
    const exclude = [];
    for (const h of s.whitelist) exclude.push(`*://${h}/*`, `*://*.${h}/*`);
    await chrome.scripting.registerContentScripts([{
      id: MAIN_SCRIPT_ID,
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: exclude,
      js: ["content/main-world.js"],
      runAt: "document_start",
      allFrames: true,
      world: "MAIN",
      persistAcrossSessions: true,
    }]);
  }

  // 4. badge
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: s.enabled });
  await chrome.action.setBadgeBackgroundColor({ color: s.enabled ? "#e5484d" : "#8b8d98" });
  await chrome.action.setTitle({ title: s.enabled ? "Nilamova Ad Blocker — ON" : "Nilamova Ad Blocker — OFF" });
}

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) missing[k] = v;
  await chrome.storage.local.set(missing);
  await applySettings();
  chrome.alarms.create("tally", { periodInMinutes: 0.5 });
  if (CONFIG.UNINSTALL_URL) chrome.runtime.setUninstallURL(CONFIG.UNINSTALL_URL);
});
chrome.runtime.onStartup.addListener(() => {
  applySettings();
  chrome.alarms.create("tally", { periodInMinutes: 0.5 });
});

/* ---------- cosmetic filters ---------- */
let cosmeticData = null;
const genericCssCache = {};
async function loadCosmetic() {
  if (cosmeticData) return cosmeticData;
  const res = await fetch(chrome.runtime.getURL("filters/cosmetic.json"));
  const raw = await res.json();
  // generic exceptions ko domain -> Set(selectors) mein ulta karo
  for (const set of Object.values(raw.sets)) {
    const inv = {};
    for (const [sel, doms] of Object.entries(set.genericExceptions)) {
      for (const d of doms) (inv[d] ||= new Set()).add(sel);
    }
    set.genericExcByDomain = inv;
  }
  raw.generichideSet = new Set(raw.generichide);
  cosmeticData = raw;
  return raw;
}

function toCss(selectors) {
  const out = [];
  for (let i = 0; i < selectors.length; i += 400) {
    out.push(selectors.slice(i, i + 400).join(",\n") + "{display:none!important}");
  }
  return out.join("\n");
}

async function cssFor(host, settings, isFrame = false) {
  const data = await loadCosmetic();
  const doms = parentDomains(host);
  const parts = [];
  const noGeneric = doms.some((d) => data.generichideSet.has(d));
  for (const c of CATEGORIES) {
    if (!settings.categories[c]) continue;
    const set = data.sets[c];
    const exc = new Set();
    for (const d of doms) {
      for (const s of set.exceptions[d] || []) exc.add(s);
      for (const s of set.genericExcByDomain[d] || []) exc.add(s);
    }
    // iframe (zyadatar ad frames, jo network level par pehle hi block hote hain) mein
    // bada generic CSS nahi lagate — page fast rehta hai. Site-specific rules phir bhi lagte hain.
    if (!noGeneric && !isFrame) {
      if (exc.size === 0) {
        parts.push(genericCssCache[c] ||= toCss(set.generic));
      } else {
        parts.push(toCss(set.generic.filter((s) => !exc.has(s))));
      }
    }
    const specific = [];
    for (const d of doms) for (const s of set.specific[d] || []) if (!exc.has(s)) specific.push(s);
    if (specific.length) parts.push(toCss(specific));
  }
  for (const d of doms) {
    const custom = settings.custom[d];
    if (custom && custom.length) parts.push(toCss(custom));
  }
  return parts.join("\n");
}

/* ---------- popup / popunder blocking ---------- */
let popupMatchers = null;
function abpToRegex(p) {
  let r = "";
  let i = 0;
  if (p.startsWith("||")) { r = "^[a-z][a-z0-9+.-]*://([^/]*\\.)?"; i = 2; }
  else if (p.startsWith("|")) { r = "^"; i = 1; }
  let end = "";
  if (p.endsWith("|")) { end = "$"; p = p.slice(0, -1); }
  for (; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") r += ".*";
    else if (ch === "^") r += "(?:[^a-zA-Z0-9_.%-]|$)";
    else r += ch.replace(/[.+?${}()|[\]\\/]/g, "\\$&");
  }
  return r + end;
}
async function loadPopup() {
  if (popupMatchers) return popupMatchers;
  const list = await (await fetch(chrome.runtime.getURL("filters/popup.json"))).json();
  const domains = new Set();
  const regs = [];
  for (const p of list) {
    const m = p.match(/^\|\|([a-z0-9.-]+)\^?$/i);
    if (m) domains.add(m[1].toLowerCase());
    else { try { regs.push(new RegExp(abpToRegex(p), "i")); } catch (_) {} }
  }
  popupMatchers = { domains, regs };
  return popupMatchers;
}
async function isPopupAd(url) {
  if (!/^https?:/.test(url)) return false;
  const { domains, regs } = await loadPopup();
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (parentDomains(host).some((d) => domains.has(d)) || domains.has(host)) return true;
  return regs.some((r) => r.test(url));
}

const newTabs = new Map(); // tabId -> {opener, time}
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
  newTabs.set(d.tabId, { opener: d.sourceTabId, time: Date.now() });
  checkNewTab(d.tabId, d.url);
});
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0 && /^https?:/.test(d.url)) chrome.storage.session.set({ ["nav" + d.tabId]: d.url });
  const info = newTabs.get(d.tabId);
  if (info && d.frameId === 0) checkNewTab(d.tabId, d.url);
});
async function checkNewTab(tabId, url) {
  const info = newTabs.get(tabId);
  if (!info) return;
  if (Date.now() - info.time > 5000) { newTabs.delete(tabId); return; }
  const s = await getSettings();
  if (!s.enabled || !s.popupBlock) return;
  try {
    const opener = await chrome.tabs.get(info.opener);
    if (isWhitelisted(s, hostOf(opener.url))) return;
  } catch (_) {}
  if (await isPopupAd(url)) {
    newTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => {});
    bumpStat("popups");
  }
}
chrome.tabs.onRemoved.addListener((id) => { newTabs.delete(id); chrome.storage.session.remove("nav" + id); });

/* ---------- stats ---------- */
async function bumpStat(key, n = 1) {
  const { stats = DEFAULTS.stats } = await chrome.storage.local.get("stats");
  stats[key] = (stats[key] || 0) + n;
  await chrome.storage.local.set({ stats });
}
function isBlockMatch(m) {
  return m.rule.rulesetId !== "_dynamic" && m.rule.rulesetId !== "_session" && m.rule.ruleId < ALLOW_ID_START;
}
let tallying = Promise.resolve();
function tally() {
  tallying = tallying.then(async () => {
    const { lastTally = Date.now() - 60000 } = await chrome.storage.session.get("lastTally");
    const now = Date.now();
    try {
      const res = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: lastTally });
      const n = res.rulesMatchedInfo.filter(isBlockMatch).length;
      await chrome.storage.session.set({ lastTally: now });
      if (n) await bumpStat("total", n);
    } catch (e) { console.warn("tally", e); }
  });
  return tallying;
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tally") tally(); });


/* ---------- messages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: String(e) }));
  return true;
});

async function handle(msg, sender) {
  const s = await getSettings();
  switch (msg.type) {
    case "cosmetic": {
      if (!s.enabled || !sender.tab) return { ok: false };
      const topHost = hostOf(sender.tab.url || "");
      if (isWhitelisted(s, topHost)) return { ok: false };
      const host = (msg.host || "").replace(/^www\./, "");
      const css = await cssFor(host, s, sender.frameId !== 0);
      if (css) {
        await chrome.scripting.insertCSS({
          target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
          css, origin: "USER",
        }).catch(() => {});
      }
      return { ok: true };
    }
    case "youtubeAllowed": {
      const host = hostOf(sender.tab?.url || "");
      return { ok: s.enabled && s.youtube && !isWhitelisted(s, host) };
    }
    case "youtubeSkipped":
      await bumpStat("youtube");
      return { ok: true };
    case "popupBlocked":
      await bumpStat("popups");
      return { ok: true };

    case "state": {
      await tally();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = hostOf(tab?.url || "");
      let pageCount = 0;
      if (tab && /^https?:/.test(tab.url || "")) {
        try {
          const r = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
          pageCount = r.rulesMatchedInfo.filter(isBlockMatch).length;
        } catch (_) {}
      }
      const fresh = await getSettings();
      return {
        settings: fresh, host, tabId: tab?.id, url: tab?.url,
        web: /^https?:/.test(tab?.url || ""),
        whitelisted: isWhitelisted(fresh, host),
        pageCount, config: CONFIG,
      };
    }
    case "setEnabled":
      await chrome.storage.local.set({ enabled: !!msg.value });
      await applySettings();
      return { ok: true };
    case "setOption": {
      if (msg.key === "category") {
        s.categories[msg.name] = !!msg.value;
        await chrome.storage.local.set({ categories: s.categories });
      } else if (["popupBlock", "youtube", "lang"].includes(msg.key)) {
        await chrome.storage.local.set({ [msg.key]: msg.value });
      }
      await applySettings();
      return { ok: true };
    }
    case "toggleSite": {
      const host = msg.host;
      if (!host) return { ok: false };
      const all = parentDomains(host);
      let wl = s.whitelist.filter((w) => !all.includes(w));
      if (wl.length === s.whitelist.length) wl.push(host);
      await chrome.storage.local.set({ whitelist: wl });
      await applySettings();
      return { ok: true };
    }
    case "startPicker": {
      await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["content/picker.js"] });
      return { ok: true };
    }
    case "addCustom": {
      const host = (msg.host || "").replace(/^www\./, "");
      if (!host || !msg.selector) return { ok: false };
      const list = s.custom[host] || [];
      if (!list.includes(msg.selector)) list.push(msg.selector);
      s.custom[host] = list;
      await chrome.storage.local.set({ custom: s.custom });
      if (sender.tab) {
        await chrome.scripting.insertCSS({
          target: { tabId: sender.tab.id, allFrames: true },
          css: `${msg.selector}{display:none!important}`, origin: "USER",
        }).catch(() => {});
      }
      return { ok: true };
    }
    case "clearCustom": {
      const host = msg.host;
      for (const d of parentDomains(host)) delete s.custom[d];
      await chrome.storage.local.set({ custom: s.custom });
      return { ok: true };
    }
    case "resetStats":
      await chrome.storage.local.set({ stats: { total: 0, popups: 0, youtube: 0, since: Date.now() } });
      return { ok: true };

    case "blockedInfo":
      const key = "nav" + sender.tab?.id;
      const r = await chrome.storage.session.get(key);
      return { url: r[key] || "" };
    case "proceed": {
      const host = hostOf(msg.url);
      if (!host) return { ok: false };
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const id = (rules.reduce((m, r) => Math.max(m, r.id), 0) || 0) + 1;
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id, priority: 1000, action: { type: "allowAllRequests" },
          condition: { requestDomains: [host], resourceTypes: ["main_frame", "sub_frame"] },
        }],
      });
      if (sender.tab) await chrome.tabs.update(sender.tab.id, { url: msg.url });
      return { ok: true };
    }
  }
  return { error: "unknown" };
}
