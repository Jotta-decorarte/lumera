// POST /api/lead — chamado pelo site quando o visitante clica num botão de WhatsApp
import { body, send, cors, clientIp, pickFields, getLead, saveLead } from "./_lib.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const b = body(req);
  const id = String(b.code || "");
  if (!/^L[A-Z0-9]{5,12}$/.test(id)) return send(res, 400, { error: "Código inválido" });

  try {
    const existing = await getLead(id);
    if (existing) return send(res, 200, { ok: true, id, existing: true });
    const f = pickFields(b);
    delete f.stage; delete f.value; delete f.name; delete f.phone; delete f.notes;
    const lead = {
      id, stage: "novo", origin: "site", createdAt: new Date().toISOString(),
      ...f,
      ip: clientIp(req), ua: String(req.headers["user-agent"] || "").slice(0, 300),
      history: [{ at: new Date().toISOString(), by: "site", stage: "novo", note: "Clicou no WhatsApp pelo site" }],
    };
    await saveLead(lead);
    send(res, 201, { ok: true, id });
  } catch (e) {
    send(res, 500, { error: "Falha ao salvar", detail: String(e.message || e) });
  }
}
