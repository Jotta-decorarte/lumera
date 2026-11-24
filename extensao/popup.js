const $ = (s) => document.querySelector(s);
chrome.storage.local.get(["crmUrl", "crmKey"]).then((v) => { if (v.crmUrl) $("#url").value = v.crmUrl; if (v.crmKey) $("#key").value = v.crmKey; });
$("#save").addEventListener("click", async () => {
  let key = $("#key").value.trim();
  const m = key.match(/[?&]key=([^&\s]+)/); if (m) key = m[1]; // aceita a URL inteira do webhook
  const url = $("#url").value.trim().replace(/\/$/, "");
  await chrome.storage.local.set({ crmUrl: url, crmKey: key });
  $("#st").textContent = "Testando…";
  try {
    const r = await fetch(url + "/api/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Key": key }, body: "[]" });
    $("#st").textContent = r.ok ? "✅ Conectado. Abra o WhatsApp Web." : r.status === 401 ? "❌ Chave errada." : "❌ Erro " + r.status;
  } catch { $("#st").textContent = "❌ Não achei o CRM nesse endereço."; }
});
