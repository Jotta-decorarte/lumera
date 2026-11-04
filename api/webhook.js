// POST /api/webhook?key=SUA_CHAVE — entrada de leads de qualquer origem
// (formulário do Meta via Zapier/Make/n8n, ferramenta de WhatsApp, outra landing page).
// Corpo JSON: { name, phone, email, code, tema, stage, value, notes, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ad_id, adset_id, campaign_id }
// Se "code" (ex.: LX4K2AB12, o código que vai na mensagem do WhatsApp) ou "phone" já existir, o lead é atualizado.
import { body, send, cors, isWebhook, pickFields, getLead, listLeads, newId, saveLead, applyUpdate } from "./_lib.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === "GET") return send(res, 200, { ok: true, info: "Envie POST com JSON. Autentique com ?key= ou cabeçalho X-Webhook-Key." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (!(await isWebhook(req))) return send(res, 401, { error: "Chave do webhook inválida" });

  try {
    const items = Array.isArray(req.body) ? req.body : [body(req)];
    const results = [];
    for (const raw of items.slice(0, 100)) {
      const f = pickFields(raw || {});
      // Código pode vir solto na mensagem: "... (cód. LX4K2AB12)"
      const code = String(raw?.code || "").toUpperCase().match(/L[A-Z0-9]{5,12}/)?.[0]
        || String(raw?.message || "").toUpperCase().match(/C[ÓO]D\.?\s*(L[A-Z0-9]{5,12})/)?.[1];
      let lead = code ? await getLead(code) : null;
      if (!lead && f.phone) lead = (await listLeads()).find((l) => l.phone === f.phone) || null;

      if (lead) {
        const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== undefined && (k === "stage" || k === "value" || k === "notes" || !lead[k])));
        await applyUpdate(lead, changes, "webhook:" + (f.source || "externo"));
        results.push({ id: lead.id, updated: true });
      } else {
        const id = code || newId();
        const stage = f.stage || "novo";
        const created = { id, origin: "webhook", createdAt: new Date().toISOString(), ...f, stage, history: [{ at: new Date().toISOString(), by: "webhook:" + (f.source || "externo"), stage }] };
        await saveLead(created);
        results.push({ id, created: true });
      }
    }
    send(res, 200, { ok: true, results });
  } catch (e) {
    send(res, 500, { error: "Falha ao processar", detail: String(e.message || e) });
  }
}
