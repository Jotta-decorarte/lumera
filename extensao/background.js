// Envia ao CRM pelo serviço de fundo (evita bloqueio de outra origem dentro do WhatsApp Web)
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "enviar") return;
  (async () => {
    const { crmUrl, crmKey } = await chrome.storage.local.get(["crmUrl", "crmKey"]);
    if (!crmUrl || !crmKey) return reply({ ok: false, error: "Configure a extensão: clique no ícone L ao lado da barra de endereço." });
    try {
      const r = await fetch(crmUrl.replace(/\/$/, "") + "/api/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Key": crmKey },
        body: JSON.stringify(msg.payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return reply({ ok: false, error: j.error || "Erro " + r.status });
      reply({ ok: true, result: (j.results || [])[0] || {} });
    } catch (e) {
      reply({ ok: false, error: "Sem conexão com o CRM" });
    }
  })();
  return true;
});
