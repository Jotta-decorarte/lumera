// /api/leads — uso interno do CRM (precisa da chave CRM_KEY)
// GET            lista os leads
// POST           cria lead manual (ex.: paciente que chamou direto no WhatsApp pelo anúncio)
// DELETE ?id=... apaga o lead
// PATCH ?id=...  atualiza etapa, nome, telefone, valor, notas (etapas agendou/fechou enviam evento ao Meta)
import { body, send, whoAmI, sameOriginOk, pickFields, getLead, listLeads, newId, saveLead, applyUpdate, deleteLead, storageMode, confirmConversation, getJSON, STAGES } from "./_lib.js";

export default async function handler(req, res) {
  if (!process.env.CRM_KEY) return send(res, 503, { error: "CRM_KEY não configurada na Vercel" });
  const me = await whoAmI(req);
  if (!me) return send(res, 401, { error: "Faça login para continuar" });
  if (!sameOriginOk(req, me)) return send(res, 400, { error: "Pedido inválido" });

  try {
    if (req.method === "GET") {
      const leads = await listLeads();
      leads.forEach((l) => { delete l.ip; delete l.ua; });
      return send(res, 200, {
        leads, stages: STAGES, storage: storageMode(), me: { user: me.user, role: me.role },
        capi: !!process.env.META_CAPI_TOKEN,
        wa: !!(await getJSON("wa:config"))?.token,
      });
    }
    if (req.method === "POST") {
      const b = body(req);
      const f = pickFields(b);
      const now = new Date().toISOString();
      // Criado no CRM a partir de uma conversa real (mensagem colada) = conversa confirmada
      const lead = { id: newId(), origin: "manual", createdAt: now, stage: "novo", kind: "conversa", conversaAt: now, ...f, history: [] };
      const stage = lead.stage; lead.stage = "novo";
      await saveLead(lead);
      if (stage !== "novo") await applyUpdate(lead, { stage }, "crm:" + me.user);
      return send(res, 201, { ok: true, lead });
    }
    if (req.method === "PATCH") {
      const id = String(req.query?.id || "");
      const lead = await getLead(id);
      if (!lead) return send(res, 404, { error: "Lead não encontrado" });
      const b = body(req);
      const f = pickFields(b);
      if ("notes" in b && !b.notes) f.notes = "";
      // Mensagem colada, ou a recepção moveu para uma etapa de atendimento: houve conversa de verdade
      if (b.confirm || (f.stage && !["novo", "perdido"].includes(f.stage))) await confirmConversation(lead, "crm:" + me.user);
      const saved = await applyUpdate(lead, f, "crm:" + me.user);
      delete saved.ip; delete saved.ua;
      return send(res, 200, { ok: true, lead: saved });
    }
    if (req.method === "DELETE" && req.query?.all === "1") {
      // Apagar todos: só agência, com confirmação digitada
      if (me.role !== "agencia") return send(res, 403, { error: "Só a agência" });
      if (body(req).confirm !== "APAGAR TUDO") return send(res, 400, { error: "Confirmação inválida" });
      const all = await listLeads(10000);
      for (const l of all) await deleteLead(l.id);
      return send(res, 200, { ok: true, deleted: all.length });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || "");
      if (!(await getLead(id))) return send(res, 404, { error: "Lead não encontrado" });
      await deleteLead(id);
      return send(res, 200, { ok: true, deleted: id });
    }
    send(res, 405, { error: "Método não suportado" });
  } catch (e) {
    send(res, 500, { error: "Erro no servidor", detail: String(e.message || e) });
  }
}
