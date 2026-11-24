// POST /api/lead — chamado pelo site quando o visitante clica num botão de WhatsApp.
// Isto registra um CLIQUE, não uma conversa: a conversa só é confirmada quando a mensagem chega
// (API oficial do WhatsApp, webhook ou mensagem colada no CRM).
import { body, send, cors, clientIp, rateLimit, pickFields, pickTouch, getLead, saveLead } from "./_lib.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const b = body(req);
  const id = String(b.code || "");
  if (!/^L[A-Z0-9]{5,12}$/.test(id)) return send(res, 400, { error: "Código inválido" });

  try {
    // Limite contra robôs: 30 cliques por hora por IP
    if (!(await rateLimit("lead:" + (clientIp(req) || "?"), 30, 3600))) return send(res, 429, { error: "Muitos pedidos" });
    const existing = await getLead(id);
    if (existing) {
      // Mesmo visitante clicou de novo (o site reaproveita o código por 30 min): só conta o clique
      existing.clicks = (existing.clicks || 1) + 1;
      await saveLead(existing);
      return send(res, 200, { ok: true, id, existing: true });
    }
    const f = pickFields(b);
    for (const k of ["stage", "value", "name", "phone", "notes", "test", "ctwa_clid", "wa_headline"]) delete f[k];
    const first = pickTouch(b.first), last = pickTouch(b.last);
    const lead = {
      id, stage: "novo", origin: "site", kind: "clique", clicks: 1, createdAt: new Date().toISOString(),
      ...f,
      ...(first ? { first } : {}), ...(last ? { last } : {}),
      ...(b.returning ? { returning: true } : {}),
      ip: clientIp(req), ua: String(req.headers["user-agent"] || "").slice(0, 300),
      history: [{ at: new Date().toISOString(), by: "site", stage: "novo", note: "Clicou no WhatsApp pelo site (conversa ainda não confirmada)" }],
    };
    await saveLead(lead);
    send(res, 201, { ok: true, id });
  } catch (e) {
    send(res, 500, { error: "Falha ao salvar" });
  }
}
