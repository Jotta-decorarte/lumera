// /api/whatsapp — receptor oficial da API do WhatsApp (Cloud API, inclusive coexistência com o app Business).
// GET  : verificação do Meta (hub.mode / hub.verify_token / hub.challenge)
// POST : mensagens recebidas, respostas enviadas pelo app (smb_message_echoes) e anúncios de clique para WhatsApp (referral).
// Segurança: só aceita POST com assinatura X-Hub-Signature-256 válida (segredo do app em WA_APP_SECRET).
// Duplicações: cada mensagem é processada uma única vez pelo id dela.
import crypto from "node:crypto";
import { getSecret, normPhone, parseMessage, findLead, newId, saveLead, applyUpdate, once, confirmConversation, getJSON, setJSON } from "./_lib.js";

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const want = process.env.WA_VERIFY_TOKEN || (await getSecret("wa_verify", 18));
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") && safeEq(q.get("hub.verify_token"), want)) {
    return new Response(q.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return json(403, { error: "Token de verificação inválido" });
}

function safeEq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function POST(request) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return json(503, { error: "WA_APP_SECRET não configurado" });
  const raw = await request.text();
  const sig = request.headers.get("x-hub-signature-256") || "";
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEq(sig, want)) return json(401, { error: "Assinatura inválida" });

  let payload;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: "JSON inválido" }); }
  const out = { messages: 0, echoes: 0, skipped: 0 };
  try {
    for (const entry of payload.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (ch.field === "messages") {
          const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
          for (const m of v.messages || []) (await inbound(m, names[m.from])) ? out.messages++ : out.skipped++;
        } else if (ch.field === "smb_message_echoes") {
          for (const m of v.message_echoes || []) (await echo(m)) ? out.echoes++ : out.skipped++;
        } else if (ch.field === "account_update") {
          await setJSON("wa:last_account_update", { at: new Date().toISOString(), event: v.event || null });
        }
      }
    }
  } catch (e) {
    // Responde 500 para o Meta reenviar; o controle por id evita duplicar o que já entrou
    return json(500, { error: "Falha ao processar" });
  }
  return json(200, { ok: true, ...out });
}

function textOf(m) {
  return m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
    || (m.type && m.type !== "text" ? `[${m.type}]` : "");
}

// Mensagem do paciente
async function inbound(m, profileName) {
  if (!m?.id || !(await once("wamsg:" + m.id))) return false;
  const phone = normPhone(m.from);
  const text = textOf(m);
  const parsed = parseMessage(text);
  // Usa a hora da mensagem só se for recente; testes do painel da Meta vêm com data antiga (2017)
  const ts = Number(m.timestamp) * 1000;
  const now = new Date(ts && Math.abs(Date.now() - ts) < 2 * 86400e3 ? ts : Date.now()).toISOString();

  // Veio de anúncio de clique para WhatsApp: o Meta informa o anúncio
  const ref = m.referral || {};
  const fromAd = {};
  if (ref.source_id || ref.ctwa_clid) {
    if (ref.source_type === "ad" && ref.source_id) fromAd.ad_id = String(ref.source_id).slice(0, 40);
    if (ref.ctwa_clid) fromAd.ctwa_clid = String(ref.ctwa_clid).slice(0, 300);
    if (ref.headline) fromAd.wa_headline = String(ref.headline).slice(0, 200);
    fromAd.utm_source = /instagram/i.test(ref.source_url || "") ? "instagram" : "facebook";
    fromAd.utm_medium = "ctwa";
  }

  let lead = await findLead({ code: parsed.code, phone });
  if (lead) {
    const first = await confirmConversation(lead, "whatsapp");
    const fill = { ...parsed, ...fromAd };
    delete fill.code;
    const changes = Object.fromEntries(Object.entries(fill).filter(([k, val]) => val && !lead[k]));
    if (!lead.phone) changes.phone = phone;
    if (!lead.name && profileName) changes.name = String(profileName).slice(0, 120);
    if (first && !lead.notes && text) changes.notes = "Primeira mensagem: " + text.slice(0, 300);
    lead.lastInboundAt = now;
    lead.msgsIn = (lead.msgsIn || 0) + 1;
    await applyUpdate(lead, changes, "whatsapp");
    return true;
  }
  const id = parsed.code || newId();
  const f = { ...parsed, ...fromAd };
  delete f.code;
  await saveLead({
    id, origin: fromAd.ctwa_clid ? "anuncio-whatsapp" : "whatsapp", kind: "conversa", stage: "novo",
    createdAt: now, conversaAt: now, lastInboundAt: now, msgsIn: 1,
    phone, ...(profileName ? { name: String(profileName).slice(0, 120) } : {}), ...f,
    ...(text ? { notes: "Primeira mensagem: " + text.slice(0, 300) } : {}),
    history: [{ at: now, by: "whatsapp", stage: "novo", note: fromAd.ad_id ? "Mensagem recebida de anúncio (" + fromAd.ad_id + ")" : "Mensagem recebida" }],
  });
  return true;
}

// Resposta enviada pela clínica no app WhatsApp Business (coexistência)
async function echo(m) {
  if (!m?.id || !(await once("waecho:" + m.id))) return false;
  const lead = await findLead({ phone: normPhone(m.to) });
  if (!lead) return false;
  const ets = Number(m.timestamp) * 1000;
  const at = new Date(ets && Math.abs(Date.now() - ets) < 2 * 86400e3 ? ets : Date.now()).toISOString();
  const changes = {};
  if (!lead.firstReplyAt) {
    lead.firstReplyAt = at;
    const base = Date.parse(lead.conversaAt || lead.createdAt);
    if (base) lead.replyMinutes = Math.max(0, Math.round((Date.parse(at) - base) / 60000));
  }
  lead.lastOutboundAt = at;
  if (lead.stage === "novo") changes.stage = "conversando";
  await applyUpdate(lead, changes, "whatsapp:clinica");
  return true;
}
