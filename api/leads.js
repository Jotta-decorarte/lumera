// /api/leads — uso interno do CRM (precisa da chave CRM_KEY)
// GET            lista os leads
// POST           cria lead manual (ex.: paciente que chamou direto no WhatsApp pelo anúncio)
// PATCH ?id=...  atualiza etapa, nome, telefone, valor, notas (etapas agendou/fechou enviam evento ao Meta)
import { body, send, cors, isCrm, pickFields, getLead, listLeads, newId, saveLead, applyUpdate, storageMode, STAGES } from "./_lib.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!process.env.CRM_KEY) return send(res, 503, { error: "CRM_KEY não configurada na Vercel" });
  if (!isCrm(req)) return send(res, 401, { error: "Chave do CRM inválida" });

  try {
    if (req.method === "GET") {
      const leads = await listLeads();
      leads.forEach((l) => { delete l.ip; delete l.ua; });
      return send(res, 200, {
        leads, stages: STAGES, storage: storageMode(),
        capi: !!process.env.META_CAPI_TOKEN, webhookKeySeparate: !!process.env.WEBHOOK_KEY,
      });
    }
    if (req.method === "POST") {
      const f = pickFields(body(req));
      const lead = { id: newId(), origin: "manual", createdAt: new Date().toISOString(), stage: "novo", ...f, history: [] };
      const stage = lead.stage; lead.stage = "novo";
      await saveLead(lead);
      if (stage !== "novo") await applyUpdate(lead, { stage }, "crm");
      return send(res, 201, { ok: true, lead });
    }
    if (req.method === "PATCH") {
      const id = String(req.query?.id || "");
      const lead = await getLead(id);
      if (!lead) return send(res, 404, { error: "Lead não encontrado" });
      const b = body(req);
      const f = pickFields(b);
      if ("notes" in b && !b.notes) f.notes = "";
      const saved = await applyUpdate(lead, f, "crm");
      delete saved.ip; delete saved.ua;
      return send(res, 200, { ok: true, lead: saved });
    }
    send(res, 405, { error: "Método não suportado" });
  } catch (e) {
    send(res, 500, { error: "Erro no servidor", detail: String(e.message || e) });
  }
}
