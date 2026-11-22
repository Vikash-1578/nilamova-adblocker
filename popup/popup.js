const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
let state = null;
let lang = "hi";

const fmt = (n) => Number(n || 0).toLocaleString("en-IN");

function t(key) { return STRINGS[lang][key] || key; }

function render() {
  const s = state.settings;
  lang = pickLang(s.lang);
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });

  document.body.classList.toggle("off", !s.enabled);
  $("power").setAttribute("aria-pressed", String(s.enabled));
  $("statusText").textContent = s.enabled ? t("on") : t("off");

  // current site
  if (state.web) {
    $("host").textContent = state.host;
    $("siteToggle").checked = !state.whitelisted;
    $("siteToggle").disabled = !s.enabled;
    $("siteBox").classList.toggle("paused", state.whitelisted);
  } else {
    $("host").textContent = t("notWeb");
    $("siteToggle").closest(".row").hidden = true;
  }

  $("pageCount").textContent = fmt(state.web && !state.whitelisted ? state.pageCount : 0);
  $("totalCount").textContent = fmt(s.stats.total);
  $("popupCount").textContent = fmt(s.stats.popups);
  $("ytCount").textContent = fmt(s.stats.youtube);
  $("sinceText").textContent = t("since") + new Date(s.stats.since || Date.now()).toLocaleDateString("en-IN");

  const canAct = state.web && s.enabled && !state.whitelisted;
  $("pickBtn").disabled = !canAct;
  const hasCustom = state.web && Object.keys(s.custom || {}).some(
    (d) => state.host === d || state.host.endsWith("." + d));
  $("clearCustomBtn").hidden = !hasCustom;
  $("reportBtn").disabled = !state.web;
  $("donateBtn").hidden = !state.config.DONATE_URL;

  document.querySelectorAll("[data-cat]").forEach((el) => { el.checked = !!s.categories[el.dataset.cat]; });
  document.querySelectorAll("[data-opt]").forEach((el) => { el.checked = !!s[el.dataset.opt]; });
}

async function refresh() {
  state = await send({ type: "state" });
  render();
}

$("power").onclick = async () => {
  await send({ type: "setEnabled", value: !state.settings.enabled });
  await refresh();
  if (state.tabId) chrome.tabs.reload(state.tabId);
};

$("siteToggle").onchange = async () => {
  await send({ type: "toggleSite", host: state.host });
  await refresh();
  chrome.tabs.reload(state.tabId);
};

$("pickBtn").onclick = async () => {
  await send({ type: "startPicker", tabId: state.tabId });
  window.close();
};

$("clearCustomBtn").onclick = async () => {
  await send({ type: "clearCustom", host: state.host });
  chrome.tabs.reload(state.tabId);
  await refresh();
};

$("reportBtn").onclick = () => {
  const url = state.config.REPORT_URL
    .replace("{host}", encodeURIComponent(state.host))
    .replace("{url}", encodeURIComponent(state.url));
  chrome.tabs.create({ url });
};

$("donateBtn").onclick = () => chrome.tabs.create({ url: state.config.DONATE_URL });

$("langBtn").onclick = async () => {
  const next = lang === "hi" ? "en" : "hi";
  await send({ type: "setOption", key: "lang", value: next });
  await refresh();
};

document.querySelectorAll("[data-cat]").forEach((el) => {
  el.onchange = async () => {
    await send({ type: "setOption", key: "category", name: el.dataset.cat, value: el.checked });
    await refresh();
  };
});
document.querySelectorAll("[data-opt]").forEach((el) => {
  el.onchange = async () => {
    await send({ type: "setOption", key: el.dataset.opt, value: el.checked });
    await refresh();
  };
});

$("resetBtn").onclick = async () => {
  await send({ type: "resetStats" });
  await refresh();
};

refresh();
