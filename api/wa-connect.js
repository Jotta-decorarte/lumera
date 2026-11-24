// /api/wa-connect — liga o número da clínica à API oficial do WhatsApp (cadastro incorporado do Meta).
// Só a agência. GET: situação da conexão. POST {code, waba_id, phone_number_id}: troca o código por token,
// inscreve o app na conta do WhatsApp e pede a sincronização de contatos e histórico (coexistência).
import { body, send, whoAmI, sameOriginOk, getJSON, setJSON, GRAPH, getSecret } from "./_lib.js";

const G = (path) => `https://graph.facebook.com/${GRAPH}/${path}`;
async function call(url, opt = {}) {
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "Meta " + r.status);
  return j;
}

export default async function handler(req, res) {
  const me = await whoAmI(req).catch(() => null);
  if (!me || me.role !== "agencia") return send(res, 401, { error: "Só a agência" });
  if (!sameOriginOk(req, me)) return send(res, 400, { error: "Pedido inválido" });
  const cfg = (await getJSON("wa:config")) || {};

  if (req.method === "GET") {
    return send(res, 200, {
      connected: !!cfg.token, waba_id: cfg.waba_id || null, phone_number_id: cfg.phone_number_id || null,
      connectedAt: cfg.connectedAt || null, sync: cfg.sync || null,
      appConfigured: !!(process.env.WA_APP_ID && process.env.WA_APP_SECRET && process.env.WA_CONFIG_ID),
      hasApp: !!process.env.WA_APP_ID, hasSecret: !!process.env.WA_APP_SECRET, hasConfig: !!process.env.WA_CONFIG_ID,
      webhookUrl: "https://" + req.headers.host + "/api/whatsapp",
      verifyToken: process.env.WA_VERIFY_TOKEN || (await getSecret("wa_verify", 18)),
    });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use GET ou POST" });

  const { WA_APP_ID: appId, WA_APP_SECRET: appSecret } = process.env;
  if (!appId || !appSecret) return send(res, 503, { error: "Faltam WA_APP_ID e WA_APP_SECRET na Vercel" });
  const b = body(req);
  const code = String(b.code || ""), waba = String(b.waba_id || "").replace(/\D/g, ""), phoneId = String(b.phone_number_id || "").replace(/\D/g, "");
  if (!code || !waba) return send(res, 400, { error: "Faltou o código ou a conta do WhatsApp" });

  try {
    const tok = await call(G(`oauth/access_token?client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`));
    const auth = { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" };
    await call(G(`${waba}/subscribed_apps`), { method: "POST", headers: auth });
    let pid = phoneId;
    if (!pid) {
      const nums = await call(G(`${waba}/phone_numbers?fields=id,display_phone_number`), { headers: auth });
      pid = nums.data?.[0]?.id || "";
    }
    // Coexistência: o número já está registrado no app; sincroniza contatos e histórico (só pode uma vez, em até 24 h)
    const sync = {};
    if (pid) {
      for (const t of ["smb_app_state_sync", "history"]) {
        try { const r = await call(G(`${pid}/smb_app_data`), { method: "POST", headers: auth, body: JSON.stringify({ messaging_product: "whatsapp", sync_type: t }) }); sync[t] = r.request_id || "ok"; }
        catch (e) { sync[t] = "erro: " + e.message; }
      }
    }
    await setJSON("wa:config", { token: tok.access_token, waba_id: waba, phone_number_id: pid, connectedAt: new Date().toISOString(), by: me.user, sync });
    send(res, 200, { ok: true, waba_id: waba, phone_number_id: pid, sync });
  } catch (e) {
    send(res, 502, { error: "Meta recusou: " + e.message });
  }
}
