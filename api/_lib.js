// Biblioteca compartilhada do CRM Luméra (armazenamento, autenticação, Meta CAPI)
import crypto from "node:crypto";

export const STAGES = ["novo", "conversando", "agendou", "compareceu", "fechou", "perdido"];

// Etapa do CRM -> evento enviado ao Meta (API de Conversões)
const CAPI_EVENTS = { conversando: "Lead", agendou: "Schedule", fechou: "Purchase" };

/* ---------------- Armazenamento (Upstash Redis via REST) ---------------- */
// Aceita KV_REST_API_URL, UPSTASH_REDIS_REST_URL ou qualquer prefixo da integração (ex.: STORAGE_KV_REST_API_URL)
const envEnding = (suffix) => Object.keys(process.env).find((k) => k.endsWith(suffix) && process.env[k]);
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env[envEnding("_REST_API_URL") || ""] || process.env[envEnding("REDIS_REST_URL") || ""];
const RTOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env[envEnding("_REST_API_TOKEN") || ""] || process.env[envEnding("REDIS_REST_TOKEN") || ""];
const mem = globalThis.__lumeraMem || (globalThis.__lumeraMem = { kv: new Map(), z: new Map() });

export const storageMode = () => (RURL && RTOKEN ? "redis" : "memory");

async function redis(cmds) {
  if (storageMode() === "memory") return cmds.map(memCmd);
  const r = await fetch(RURL.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${RTOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("Redis " + r.status + ": " + (await r.text()));
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

function memCmd([op, ...a]) {
  // Só para testes locais: some quando a função reinicia.
  switch (op) {
    case "GET": return mem.kv.get(a[0]) ?? null;
    case "SET": if (a[2] === "NX" && mem.kv.has(a[0])) return null; mem.kv.set(a[0], a[1]); return "OK";
    case "MGET": return a.map((k) => mem.kv.get(k) ?? null);
    case "ZADD": mem.z.set(a[2], Number(a[1])); return 1;
    case "DEL": return mem.kv.delete(a[0]) ? 1 : 0;
    case "ZREM": return mem.z.delete(a[1]) ? 1 : 0;
    case "INCR": { const v = Number(mem.kv.get(a[0]) || 0) + 1; mem.kv.set(a[0], String(v)); return v; }
    case "EXPIRE": return 1;
    case "ZREVRANGE": return [...mem.z.entries()].sort((x, y) => y[1] - x[1]).slice(Number(a[1]), Number(a[2]) + 1).map((e) => e[0]);
    default: throw new Error("memCmd " + op);
  }
}

export async function getLead(id) {
  const [v] = await redis([["GET", "lead:" + id]]);
  return v ? JSON.parse(v) : null;
}

export async function saveLead(lead) {
  lead.updatedAt = new Date().toISOString();
  await redis([
    ["SET", "lead:" + lead.id, JSON.stringify(lead)],
    ["ZADD", "leads", String(Date.parse(lead.createdAt) || Date.now()), lead.id],
  ]);
  return lead;
}

export async function deleteLead(id) {
  await redis([["DEL", "lead:" + id], ["ZREM", "leads", id]]);
}

export async function listLeads(limit = 1000) {
  const [ids] = await redis([["ZREVRANGE", "leads", "0", String(limit - 1)]]);
  if (!ids || !ids.length) return [];
  const [vals] = await redis([["MGET", ...ids.map((i) => "lead:" + i)]]);
  return vals.filter(Boolean).map((v) => JSON.parse(v));
}

/* ---------------- Helpers HTTP ---------------- */
export function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

export function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(data);
}

export function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CRM-Key, X-Webhook-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || "").trim()), y = Buffer.from(String(b || "").trim());
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function isCrm(req) {
  const key = process.env.CRM_KEY;
  if (!key) return false;
  const got = req.headers["x-crm-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(got, key);
}

export async function isWebhook(req) {
  const got = req.headers["x-webhook-key"] || req.query?.key || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  // Aceita a WEBHOOK_KEY da Vercel ou a chave gerada e guardada no banco (aparece na aba Integração da agência)
  const stored = await getSecret("webhook", 18);
  return [process.env.WEBHOOK_KEY, stored].some((k) => k && safeEqual(got, k));
}

// Segredos gerados na primeira vez e guardados no banco (não ficam no código nem com a clínica)
const secretCache = {};
export async function getSecret(name, bytes = 32) {
  if (secretCache[name]) return secretCache[name];
  const [v] = await redis([["GET", "secret:" + name]]);
  if (v) return (secretCache[name] = v);
  const fresh = crypto.randomBytes(bytes).toString("base64url");
  const [ok] = await redis([["SET", "secret:" + name, fresh, "NX"]]);
  if (ok) return (secretCache[name] = fresh);
  const [again] = await redis([["GET", "secret:" + name]]);
  return (secretCache[name] = again);
}

export const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;

/* ---------------- Normalização de lead ---------------- */
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const clip = (v, n = 200) => (v == null || v === "" ? undefined : String(v).slice(0, n));

export function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return undefined;
  if (d.length === 10 || d.length === 11) d = "55" + d; // número BR sem DDI
  return d;
}

export function newId() {
  return "L" + Date.now().toString(36).toUpperCase().slice(-5) + crypto.randomBytes(2).toString("hex").toUpperCase();
}

// Copia apenas campos conhecidos de uma entrada externa
export function pickFields(src) {
  const o = {};
  for (const k of UTM) if (src[k]) o[k] = clip(src[k]);
  for (const k of ["name", "tema", "source", "notes", "landing", "referrer", "fbclid", "fbc", "fbp", "ad_id", "adset_id", "campaign_id"]) if (src[k]) o[k] = clip(src[k], k === "notes" ? 2000 : 300);
  if (src.phone) o.phone = normPhone(src.phone);
  if (src.email) o.email = clip(String(src.email).toLowerCase().trim());
  if (src.value != null && src.value !== "" && !isNaN(Number(src.value))) o.value = Number(src.value);
  if (src.stage && STAGES.includes(src.stage)) o.stage = src.stage;
  return o;
}

/* ---------------- Meta API de Conversões ---------------- */
const sha = (v) => (v ? crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex") : undefined);

export async function sendCapi(lead, stage) {
  const event_name = CAPI_EVENTS[stage];
  const token = process.env.META_CAPI_TOKEN;
  const pixel = process.env.META_PIXEL_ID || "1127167810011936";
  if (!event_name) return null;
  if (!token) return { skipped: "META_CAPI_TOKEN não configurado" };

  const user_data = {
    external_id: [sha(lead.id)],
    ph: lead.phone ? [sha(lead.phone)] : undefined,
    em: lead.email ? [sha(lead.email)] : undefined,
    fn: lead.name ? [sha(lead.name.split(" ")[0])] : undefined,
    ct: [sha("novaiguacu")], st: [sha("rj")], country: [sha("br")],
    fbc: lead.fbc, fbp: lead.fbp,
    client_ip_address: lead.ip || undefined,
    client_user_agent: lead.ua || undefined,
  };
  const ev = {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `${lead.id}-${stage}`,
    action_source: lead.fbp || lead.fbc ? "website" : "system_generated",
    event_source_url: lead.landing || undefined,
    user_data,
    custom_data: {
      lead_code: lead.id, tema: lead.tema, crm_stage: stage,
      utm_campaign: lead.utm_campaign, utm_content: lead.utm_content,
      ...(event_name === "Purchase" ? { currency: "BRL", value: Number(lead.value) || 0 } : {}),
    },
  };
  const payload = { data: [ev] };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, event: event_name, fbtrace_id: j.fbtrace_id } : { ok: false, event: event_name, error: j.error?.message || r.status };
  } catch (e) {
    return { ok: false, event: event_name, error: String(e.message || e) };
  }
}

// Aplica mudanças num lead, registra histórico e dispara CAPI quando a etapa avança
export async function applyUpdate(lead, changes, by) {
  const before = lead.stage;
  Object.assign(lead, changes);
  lead.history = lead.history || [];
  if (changes.stage && changes.stage !== before) {
    const capi = await sendCapi(lead, changes.stage);
    lead.history.push({ at: new Date().toISOString(), by, stage: changes.stage, from: before, ...(capi ? { capi } : {}) });
  } else if (Object.keys(changes).length) {
    lead.history.push({ at: new Date().toISOString(), by, edit: Object.keys(changes) });
  }
  if (lead.history.length > 50) lead.history = lead.history.slice(-50);
  return saveLead(lead);
}


/* ---------------- Segurança: usuários, senhas, sessão, limites ---------------- */
// Senhas guardadas só como hash scrypt com sal aleatório. Nunca em texto puro.
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) {
    crypto.scryptSync("x", "padding-salt", 64); // mesmo tempo de resposta quando o usuário não existe
    return false;
  }
  const got = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashHex, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function getUsers() {
  const [v] = await redis([["GET", "users"]]);
  return v ? JSON.parse(v) : {};
}
export async function saveUsers(users) {
  await redis([["SET", "users", JSON.stringify(users)]]);
}

// Limite de tentativas: devolve true se ainda pode tentar
export async function rateLimit(key, limit, windowSec) {
  const [n] = await redis([["INCR", "rl:" + key]]);
  if (Number(n) === 1) await redis([["EXPIRE", "rl:" + key, String(windowSec)]]);
  return Number(n) <= limit;
}
export async function rateCount(key) {
  const [v] = await redis([["GET", "rl:" + key]]);
  return Number(v || 0);
}
export async function rateReset(key) {
  await redis([["DEL", "rl:" + key]]);
}

// Sessão assinada com HMAC (o segredo é a CRM_KEY ou SESSION_SECRET da Vercel)
const COOKIE = "lumera_sess";
let SESSION_KEY = "";
async function sessionKey() { return process.env.SESSION_SECRET || (SESSION_KEY ||= await getSecret("session", 32)); }
const b64u = (b) => Buffer.from(b).toString("base64url");
export async function signSession(data) {
  const payload = b64u(JSON.stringify(data));
  const sig = crypto.createHmac("sha256", await sessionKey()).update(payload).digest("base64url");
  return payload + "." + sig;
}
async function readSession(token) {
  if (!token) return null;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const want = crypto.createHmac("sha256", await sessionKey()).update(payload).digest("base64url");
  if (!safeEqual(sig, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
export async function setSessionCookie(res, data, maxAgeSec) {
  const tok = await signSession({ ...data, exp: Date.now() + maxAgeSec * 1000 });
  res.setHeader("Set-Cookie", `${COOKIE}=${tok}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

// Quem está chamando: sessão (cookie) ou chave mestra no cabeçalho (automação). Confere se o usuário ainda existe com a mesma versão de senha.
export async function whoAmI(req) {
  const users = await getUsers();
  // A chave mestra (CRM_KEY) só vale para a configuração inicial, enquanto não existe nenhum usuário de agência
  const hasAgency = Object.values(users).some((u) => u.role === "agencia");
  if (!hasAgency && isCrm(req)) return { user: "configuracao-inicial", role: "agencia", via: "key" };
  const s = await readSession(cookies(req)[COOKIE]);
  if (!s) return null;
  const u = users[s.user];
  if (!u || u.role !== s.role || u.v !== s.v) return null; // senha trocada ou usuário removido derruba a sessão
  return { user: s.user, role: s.role, via: "cookie" };
}

// Proteção contra ataque entre sites: pedidos que alteram dados com cookie precisam vir do próprio CRM
export function sameOriginOk(req, me) {
  if (!me || me.via === "key") return true;
  if (req.method === "GET") return true;
  return req.headers["x-requested-with"] === "lumera-crm";
}
