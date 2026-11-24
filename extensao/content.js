// Luméra CRM · botão "Enviar ao CRM" no WhatsApp Web.
// Só lê a conversa aberta, e só quando a recepção clica. Não envia mensagens nem roda sozinho.
(() => {
  if (window.__lumeraCrm) return;
  window.__lumeraCrm = true;

  const host = document.createElement("div");
  host.id = "lumera-crm-host";
  host.style.cssText = "position:fixed;right:18px;bottom:86px;z-index:2147483646";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;font-family:"Segoe UI",system-ui,sans-serif}
.fab{display:flex;align-items:center;gap:8px;background:#151C2C;color:#E5B75F;border:1px solid #E5B75F;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.fab:hover{background:#E5B75F;color:#151C2C}
.fab[hidden]{display:none}
.panel{position:fixed;right:18px;bottom:86px;width:340px;max-height:80vh;overflow:auto;background:#151C2C;color:#F4F0E9;border:1px solid rgba(229,183,95,.35);border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);font-size:13.5px}
.panel[hidden]{display:none}
h3{margin:0 0 10px;font-size:15px;font-weight:600;color:#E5B75F}
label{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#9AA1B2;margin:10px 0 4px}
input,select{width:100%;background:#0E1320;color:#F4F0E9;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px 9px;font-size:13.5px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.msgs{background:#0E1320;border-radius:8px;padding:8px 10px;max-height:130px;overflow:auto;color:#C9CDD6;font-size:12.5px;white-space:pre-wrap}
.btns{display:flex;gap:8px;margin-top:14px}
button.go{flex:1;background:#E5B75F;color:#151C2C;border:0;border-radius:8px;padding:10px;font-weight:600;cursor:pointer}
button.x{background:transparent;color:#F4F0E9;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:10px 14px;cursor:pointer}
.st{margin-top:10px;min-height:1.2em;font-size:12.5px}
.hint{color:#9AA1B2;font-size:11.5px;margin-top:4px}
</style>
<button class="fab" id="fab" hidden>＋ Enviar ao CRM</button>
<div class="panel" id="panel" hidden>
  <h3>Enviar conversa ao CRM</h3>
  <div class="row">
    <div><label for="nome">Nome</label><input id="nome"></div>
    <div><label for="tel">WhatsApp</label><input id="tel" inputmode="tel" placeholder="21 9…"></div>
  </div>
  <div class="hint" id="telHint"></div>
  <div class="row">
    <div><label for="etapa">Etapa</label>
      <select id="etapa"><option value="novo">Novo</option><option value="conversando" selected>Conversando</option><option value="agendou">Agendou</option><option value="compareceu">Compareceu</option><option value="fechou">Fechou</option><option value="perdido">Perdido</option></select></div>
    <div><label for="tema">Assunto</label>
      <select id="tema"><option value="">Detectar sozinho</option><option>AVALIAÇÃO</option><option>IMPLANTE</option><option>CLAREAMENTO</option><option>PREVENÇÃO</option><option>EXTRAÇÃO</option><option>DÚVIDA</option></select></div>
  </div>
  <div id="valorWrap" hidden><label for="valor">Valor fechado (R$)</label><input id="valor" inputmode="decimal" placeholder="0,00"></div>
  <label>Mensagens do paciente que vão junto</label>
  <div class="msgs" id="msgs"></div>
  <div class="btns"><button class="go" id="go">Enviar</button><button class="x" id="x">Fechar</button></div>
  <div class="st" id="st"></div>
</div>`;
  document.documentElement.appendChild(host);
  const $ = (s) => root.getElementById(s);

  // ---------- Leitura da conversa aberta ----------
  const main = () => document.querySelector("#main");

  function chatName() {
    const h = main()?.querySelector("header");
    if (!h) return "";
    const el = h.querySelector("span[dir='auto'][title]") || h.querySelector("span[dir='auto']") || h.querySelector("[title]");
    return (el?.getAttribute("title") || el?.textContent || "").trim();
  }

  function chatPhone(name) {
    // 1) id interno das mensagens: false_5521999999999@c.us_ABC
    for (const el of main()?.querySelectorAll("[data-id]") || []) {
      const m = String(el.getAttribute("data-id")).match(/(?:true|false)_(\d{10,15})@c\.us/);
      if (m) return m[1];
    }
    // 2) contato não salvo: o título da conversa é o próprio número
    const d = String(name || "").replace(/\D/g, "");
    return d.length >= 10 && d.length <= 15 ? d : "";
  }

  function chatMessages() {
    const out = [];
    const seen = new Set();
    for (const el of main()?.querySelectorAll("[data-pre-plain-text]") || []) {
      const row = el.closest("[data-id]");
      const id = row?.getAttribute("data-id") || "";
      const incoming = id ? id.startsWith("false_") : !!el.closest(".message-in");
      if (!incoming) continue;
      const txt = (el.querySelector(".selectable-text")?.innerText || el.innerText || "").trim();
      if (!txt || seen.has(txt)) continue;
      seen.add(txt);
      out.push(txt);
    }
    return out;
  }

  // Primeiras mensagens (onde vem o código do anúncio/site) + as últimas
  function pickMessages(all) {
    if (all.length <= 8) return all;
    return [...all.slice(0, 3), "…", ...all.slice(-5)];
  }

  // ---------- Tela ----------
  function refreshFab() {
    $("fab").hidden = !main() || !$("panel").hidden;
  }
  setInterval(refreshFab, 1000);

  let current = { msgs: [] };
  $("fab").addEventListener("click", () => {
    const name = chatName();
    const phone = chatPhone(name);
    const msgs = pickMessages(chatMessages());
    current = { msgs };
    $("nome").value = /\d{6,}/.test(name) ? "" : name;
    $("tel").value = phone;
    $("telHint").textContent = phone ? "" : "Não consegui ler o número nesta conversa. Digite o WhatsApp do paciente.";
    $("msgs").textContent = msgs.length ? msgs.join("\n") : "(nenhuma mensagem do paciente visível; role a conversa para cima se precisar)";
    $("etapa").value = "conversando";
    $("tema").value = "";
    $("valor").value = "";
    $("valorWrap").hidden = true;
    $("st").textContent = "";
    $("panel").hidden = false;
    refreshFab();
  });
  $("x").addEventListener("click", () => { $("panel").hidden = true; refreshFab(); });
  $("etapa").addEventListener("change", () => { $("valorWrap").hidden = $("etapa").value !== "fechou"; });

  $("go").addEventListener("click", () => {
    const phone = $("tel").value.replace(/\D/g, "");
    if (phone.length < 10) { $("st").textContent = "Informe o WhatsApp com DDD."; return; }
    const stage = $("etapa").value;
    const valor = $("valor").value.replace(/\./g, "").replace(",", ".").trim();
    if (stage === "fechou" && !(Number(valor) > 0)) { $("st").textContent = "Informe o valor fechado."; return; }
    const payload = { name: $("nome").value.trim() || undefined, phone, source: "extensao-whatsapp", stage };
    if (current.msgs.length) payload.message = current.msgs.filter((m) => m !== "…").join("\n");
    if ($("tema").value) payload.tema = $("tema").value;
    if (stage === "fechou") payload.value = Number(valor);
    $("go").disabled = true;
    $("st").textContent = "Enviando…";
    chrome.runtime.sendMessage({ type: "enviar", payload }, (r) => {
      $("go").disabled = false;
      if (chrome.runtime.lastError) { $("st").textContent = "❌ Recarregue a página do WhatsApp (F5) e tente de novo."; return; }
      if (!r?.ok) { $("st").textContent = "❌ " + (r?.error || "Falhou"); return; }
      const res = r.result || {};
      $("st").textContent = "✅ " + (res.created ? "Cartão criado" : "Cartão atualizado") + (res.id ? " (" + res.id + ")" : "") + ".";
      setTimeout(() => { $("panel").hidden = true; refreshFab(); }, 1800);
    });
  });
})();
