const $ = (id) => document.getElementById(id);
chrome.storage.local.get(["token", "method", "bot"]).then(({ token = "", method = "squash", bot = "greptile" }) => {
  $("token").value = token;
  $("method").value = method;
  $("bot").value = bot;
});
$("save").onclick = async () => {
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    method: $("method").value,
    bot: $("bot").value.trim() || "greptile",
  });
  $("ok").textContent = "Saved ✓";
};
