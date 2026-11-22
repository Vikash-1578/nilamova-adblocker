// Element picker: user kisi ad par click kare -> wo hamesha ke liye chhup jaye.
(async () => {
  if (window.__vabPicker) return;
  window.__vabPicker = true;

  const { lang = "auto" } = await chrome.storage.local.get("lang");
  const l = navigator.language || "en";
  const hi = lang === "hi" || (lang === "auto" && (l.startsWith("hi") || l.endsWith("-IN")));
  const T = hi
    ? { tip: "Jis ad ko hatana hai us par click karo  •  Esc = band", done: "Hata diya! Is site par ab ye nahi dikhega.", up: "↑ Bada hissa", ok: "✓ Hatao", cancel: "✕ Band" }
    : { tip: "Click the ad you want to remove  •  Esc = cancel", done: "Removed! It won't show on this site again.", up: "↑ Bigger area", ok: "✓ Remove", cancel: "✕ Cancel" };

  const root = document.createElement("div");
  root.attachShadow({ mode: "open" });
  root.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  root.shadowRoot.innerHTML = `
    <style>
      .box{position:fixed;background:rgba(229,72,77,.25);outline:2px solid #e5484d;pointer-events:none;transition:all .05s}
      .bar{position:fixed;left:50%;top:12px;transform:translateX(-50%);background:#111;color:#fff;font:14px system-ui,sans-serif;
           padding:10px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:auto;display:flex;gap:8px;align-items:center}
      button{font:13px system-ui,sans-serif;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
      .ok{background:#e5484d;color:#fff}.up,.x{background:#333;color:#fff}
      .sel{font:11px monospace;color:#aaa;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    </style>
    <div class="box"></div>
    <div class="bar"><span class="tip">${T.tip}</span><span class="sel"></span>
      <button class="up" hidden>${T.up}</button><button class="ok" hidden>${T.ok}</button><button class="x">${T.cancel}</button></div>`;
  document.documentElement.appendChild(root);
  const $ = (s) => root.shadowRoot.querySelector(s);
  const box = $(".box"), tip = $(".tip"), selLabel = $(".sel"), btnUp = $(".up"), btnOk = $(".ok");

  let current = null, locked = false;

  function draw(el) {
    if (!el) { box.style.width = "0"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }

  const looksRandom = (s) => /\d{3,}|[a-f0-9]{8,}|^[a-z]{1,2}\d|__|--/i.test(s);
  function selectorFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && !looksRandom(node.id)) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !looksRandom(c)).slice(0, 3);
      if (classes.length) part += "." + classes.map(CSS.escape).join(".");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1 && !classes.length) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
      node = parent;
    }
    return parts.join(" > ");
  }

  function onMove(e) {
    if (locked) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === root) return;
    current = el;
    draw(el);
  }
  function lock(e) {
    if (e.composedPath().includes(root)) return;
    e.preventDefault(); e.stopPropagation();
    if (!current) return;
    locked = true;
    show();
  }
  function show() {
    draw(current);
    selLabel.textContent = selectorFor(current);
    tip.hidden = true;
    btnUp.hidden = !current.parentElement || current.parentElement === document.body;
    btnOk.hidden = false;
  }
  btnUp.onclick = () => { if (current.parentElement) { current = current.parentElement; show(); } };
  btnOk.onclick = async () => {
    const selector = selectorFor(current);
    current.style.setProperty("display", "none", "important");
    await chrome.runtime.sendMessage({ type: "addCustom", host: location.hostname, selector }).catch(() => {});
    tip.textContent = T.done; tip.hidden = false;
    selLabel.textContent = ""; btnOk.hidden = btnUp.hidden = true;
    setTimeout(close, 1500);
  };
  $(".x").onclick = close;

  function onKey(e) { if (e.key === "Escape") close(); }
  function close() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", lock, true);
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    window.__vabPicker = false;
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", lock, true);
  document.addEventListener("keydown", onKey, true);
})();
