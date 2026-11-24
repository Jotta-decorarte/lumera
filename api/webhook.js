// POST /api/webhook?key=SUA_CHAVE — entrada de leads de qualquer origem
// (formulário do Meta via Zapier/Make/n8n, ferramenta de WhatsApp, outra landing page).
// Corpo JSON: { name, phone, email, code, message, tema, stage, value, notes, source, utm_*, ad_id, adset_id, campaign_id, event_id }
// Se "code" (ex.: LX4K2AB12) ou "phone" já existir, o lead é atualizado. Se vier "message", a conversa fica confirmada.
// "event_id" evita processar o mesmo envio duas vezes.
import { body, send, cors, isWebhook, pickFields, parseMessage, findLead, newId, saveLead, applyUpdate, once, confirmConversation } from "./_lib.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === "GET") return send(res, 200, { ok: true, info: "Envie POST com JSON. Autentique com ?key= ou cabeçalho X-Webhook-Key." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (!(await isWebhook(req))) return send(res, 401, { error: "Chave do webhook inválida" });

  try {
    const items = Array.isArray(req.body) ? req.body : [body(req)];
    const results = [];
    for (const raw of items.slice(0, 100)) {
      if (raw?.event_id && !(await once("hook:" + String(raw.event_id).slice(0, 120)))) { results.push({ duplicate: true }); continue; }
      const parsed = parseMessage(raw?.message);
      const f = { ...parsed, ...pickFields(raw || {}) };
      delete f.code;
      const code = String(raw?.code || "").toUpperCase().match(/L[A-Z0-9]{5,12}/)?.[0] || parsed.code;
      let lead = await findLead({ code, phone: f.phone });
      const by = "webhook:" + (f.source || "externo");

      if (lead) {
        const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== undefined && (k === "stage" || k === "value" || k === "notes" || k === "test" || !lead[k])));
        if (raw?.message) await confirmConversation(lead, by);
        await applyUpdate(lead, changes, by);
        results.push({ id: lead.id, updated: true });
      } else {
        const id = code || newId();
        const stage = f.stage || "novo";
        const now = new Date().toISOString();
        const created = { id, origin: "webhook", createdAt: now, ...f, stage, kind: raw?.message ? "conversa" : "contato", ...(raw?.message ? { conversaAt: now } : {}), history: [{ at: now, by, stage }] };
        await saveLead(created);
        results.push({ id, created: true });
      }
    }
    send(res, 200, { ok: true, results });
  } catch (e) {
    send(res, 500, { error: "Falha ao processar" });
  }
}
