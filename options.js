const $ = (id) => document.getElementById(id);
chrome.storage.local.get(["token", "method", "bot"]).then(({ token = "", method = "squash", bot = "greptile" }) => {
  $("token").value = token;
  $("method").value = method;
  $("bot").value = bot;
});
$("save").onclick = async () => {
  // Firefox lets users revoke MV3 host permissions; re-request them (needs this click's user gesture, so before any await).
  const granted = chrome.permissions.request({ origins: ["https://api.github.com/*", "https://github.com/*"] });
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    method: $("method").value,
    bot: $("bot").value.trim() || "greptile",
  });
  $("ok").textContent = (await granted.catch(() => false))
    ? "Saved ✓"
    : "Saved, but GitHub access was not granted — the extension can't run without it.";
};
