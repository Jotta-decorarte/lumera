// /crm/agencia — guia da agência, protegido no servidor
import { whoAmI } from "./_lib.js";
import html from "./_agencia-html.js";

export default async function handler(req, res) {
  const me = await whoAmI(req).catch(() => null);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!me || me.role !== "agencia") {
    res.statusCode = 302;
    res.setHeader("Location", "/crm?area=agencia");
    return res.end();
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}
