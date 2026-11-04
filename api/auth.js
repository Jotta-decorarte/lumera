// /api/auth — login, logout, sessão atual e gestão de usuários
// POST {action:"login", user, password}
// POST {action:"logout"}
// GET  -> {user, role} ou 401
// POST {action:"set-user", user, password, role}  (só agência) cria usuário ou troca a senha
import crypto from "node:crypto";
import { body, send, clientIp, getSecret, getUsers, saveUsers, hashPassword, verifyPassword, rateLimit, rateCount, rateReset, setSessionCookie, clearSessionCookie, whoAmI, sameOriginOk } from "./_lib.js";

const SESSION_DAYS = { clinica: 30, agencia: 7 };
const USER_RE = /^[a-z0-9._-]{2,32}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.CRM_KEY) return send(res, 503, { error: "CRM_KEY não configurada na Vercel" });

  try {
    if (req.method === "GET") {
      const me = await whoAmI(req);
      return me ? send(res, 200, { user: me.user, role: me.role }) : send(res, 401, { error: "Não conectado" });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
    const b = body(req);

    if (b.action === "logout") { clearSessionCookie(res); return send(res, 200, { ok: true }); }

    if (b.action === "login") {
      if (req.headers["x-requested-with"] !== "lumera-crm") return send(res, 400, { error: "Pedido inválido" });
      const user = String(b.user || "").trim().toLowerCase();
      const pw = String(b.password || "");
      const ip = clientIp(req) || "?";
      // Bloqueio: 8 erros por IP ou 6 por usuário em 15 minutos
      if ((await rateCount("ip:" + ip)) >= 8 || (await rateCount("user:" + user)) >= 6) {
        return send(res, 429, { error: "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo." });
      }
      const users = await getUsers();
      const u = USER_RE.test(user) ? users[user] : null;
      const ok = verifyPassword(pw, u && u.hash);
      if (!ok || !u) {
        await rateLimit("ip:" + ip, 8, 900);
        await rateLimit("user:" + user, 6, 900);
        await new Promise((r) => setTimeout(r, 400 + crypto.randomInt(400)));
        return send(res, 401, { error: "Usuário ou senha incorretos" });
      }
      await rateReset("user:" + user);
      await setSessionCookie(res, { user, role: u.role, v: u.v }, SESSION_DAYS[u.role] * 86400);
      return send(res, 200, { ok: true, user, role: u.role });
    }

    if (b.action === "set-user") {
      const me = await whoAmI(req);
      if (!me || me.role !== "agencia") return send(res, 403, { error: "Só a agência pode gerenciar usuários" });
      if (!sameOriginOk(req, me)) return send(res, 400, { error: "Pedido inválido" });
      const user = String(b.user || "").trim().toLowerCase();
      const role = b.role === "agencia" ? "agencia" : "clinica";
      const pw = String(b.password || "");
      if (!USER_RE.test(user)) return send(res, 400, { error: "Usuário deve ter de 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado" });
      if (pw.length < 8) return send(res, 400, { error: "A senha precisa ter pelo menos 8 caracteres" });
      const users = await getUsers();
      users[user] = { role, hash: hashPassword(pw), v: crypto.randomBytes(4).toString("hex"), updatedAt: new Date().toISOString() };
      await saveUsers(users);
      await rateReset("user:" + user);
      return send(res, 200, { ok: true, user, role });
    }

    if (b.action === "list-users") {
      const me = await whoAmI(req);
      if (!me || me.role !== "agencia") return send(res, 403, { error: "Só a agência" });
      const users = await getUsers();
      return send(res, 200, { users: Object.entries(users).map(([k, v]) => ({ user: k, role: v.role, updatedAt: v.updatedAt })), webhookKey: process.env.WEBHOOK_KEY || (await getSecret("webhook", 18)) });
    }

    send(res, 400, { error: "Ação desconhecida" });
  } catch (e) {
    send(res, 500, { error: "Erro no servidor" });
  }
}
