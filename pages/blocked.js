(async () => {
  const { url = "" } = await chrome.runtime.sendMessage({ type: "blockedInfo" });
  document.getElementById("url").textContent = url || "(unknown)";
  document.getElementById("back").onclick = () => {
    if (history.length > 1) history.back(); else window.close();
  };
  const go = document.getElementById("go");
  if (!url) go.hidden = true;
  go.onclick = () => chrome.runtime.sendMessage({ type: "proceed", url });
})();
