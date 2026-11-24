// /api/export.csv?key=CHAVE — planilha automática para o Google Sheets (=IMPORTDATA) ou Excel.
// Sem telefone e sem anotações. Leads de teste ficam de fora. ?todos=1 inclui cliques sem conversa.
import crypto from "node:crypto";
import { listLeads, getSecret } from "./_lib.js";

const esc = (v) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const d = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const isClick = (l) => (l.kind ? l.kind === "clique" : l.origin === "site" && (l.stage === "novo" || !l.stage));
const reached = (l, s) => (l.history || []).some((h) => h.stage === s) || l.stage === s;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const key = await getSecret("export", 18);
  const got = Buffer.from(String(req.query?.key || "")), want = Buffer.from(key);
  if (!(got.length === want.length && crypto.timingSafeEqual(got, want))) { res.statusCode = 401; return res.end("Chave inválida"); }

  const all = req.query?.todos === "1";
  const leads = (await listLeads(5000)).filter((l) => !l.test && (all || !isClick(l))).reverse();
  const head = ["Data", "Código", "Nome", "Assunto", "Origem", "Plataforma", "Campanha", "Conjunto", "Anúncio", "ID do anúncio", "Conversa confirmada", "Etapa atual", "Agendou", "Compareceu", "Fechou", "Valor (R$)", "Data do fechamento", "Minutos até 1ª resposta"];
  const rows = leads.map((l) => {
    const fech = (l.history || []).filter((h) => h.stage === "fechou").pop();
    return [d(l.createdAt), l.id, l.name, l.tema, l.origin, l.utm_source, l.utm_campaign, l.utm_term, l.utm_content || l.wa_headline, l.ad_id,
      isClick(l) ? "não" : "sim", l.stage, reached(l, "agendou") || reached(l, "compareceu") || reached(l, "fechou") ? "sim" : "",
      reached(l, "compareceu") || reached(l, "fechou") ? "sim" : "", l.stage === "fechou" ? "sim" : "",
      l.stage === "fechou" ? String(Number(l.value) || 0).replace(".", ",") : "", fech ? d(fech.at) : "", l.replyMinutes ?? ""];
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.end([head, ...rows].map((r) => r.map(esc).join(",")).join("\n"));
}
