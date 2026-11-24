// /conectar-whatsapp — página da agência com o botão oficial do Meta para ligar o número (coexistência)
import { whoAmI, GRAPH } from "./_lib.js";

export default async function handler(req, res) {
  const me = await whoAmI(req).catch(() => null);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!me || me.role !== "agencia") { res.statusCode = 302; res.setHeader("Location", "/crm?area=agencia"); return res.end(); }
  const appId = process.env.WA_APP_ID || "", configId = process.env.WA_CONFIG_ID || "";
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; connect-src 'self' https://*.facebook.com https://*.facebook.net; frame-src https://*.facebook.com; img-src 'self' data: https://*.facebook.com https://*.fbcdn.net; style-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Conectar WhatsApp</title><style>
:root{--bg:#0E1320;--panel:#1B2336;--ivory:#F4F0E9;--muted:#9AA1B2;--gold:#E5B75F}
body{margin:0;background:var(--bg);color:var(--ivory);font:15px/1.6 "Segoe UI",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:var(--panel);border:1px solid rgba(229,183,95,.2);border-radius:18px;padding:28px;max-width:560px;width:100%;box-sizing:border-box}
h1{font-weight:500;margin:0 0 8px}p,li{color:var(--muted)}b{color:var(--ivory)}
button{background:#25D366;border:0;border-radius:10px;padding:12px 18px;font-weight:600;font-size:15px;cursor:pointer;color:#06210f}
button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:10px;font-size:13px}
code{background:var(--bg);padding:2px 6px;border-radius:6px;word-break:break-all}a{color:var(--gold)}</style></head><body><main>
<h1>Conectar o WhatsApp da clínica</h1>
<p>Liga o número que já usa o <b>WhatsApp Business no celular</b> à API oficial, sem perder o app (coexistência). As mensagens passam a entrar sozinhas no CRM.</p>
<ol><li>Tenha o celular da clínica em mãos, com o app WhatsApp Business atualizado.</li><li>Clique no botão, entre com o Facebook de quem administra a clínica e escolha <b>conectar a conta existente do WhatsApp Business</b>.</li><li>Leia o QR code que aparece, pelo app no celular, e aceite compartilhar o histórico.</li></ol>
<p><button id="go" ${appId && configId ? "" : "disabled"}>Conectar WhatsApp</button></p>
<p id="st">${appId && configId ? "" : "Faltam WA_APP_ID e WA_CONFIG_ID na Vercel."}</p>
<pre id="out" hidden></pre>
<p><a href="/crm#integracao">Voltar ao CRM</a></p>
</main>
<script>
var info={};
window.addEventListener("message",function(e){
  if(!/(^|\\.)facebook\\.com$/.test(new URL(e.origin).hostname))return;
  try{var d=JSON.parse(e.data);if(d.type!=="WA_EMBEDDED_SIGNUP")return;
    if(d.event==="CANCEL"){st("Cancelado na etapa: "+(d.data&&d.data.current_step||"?"));return}
    if(d.event==="ERROR"){st("Erro do Meta: "+(d.data&&d.data.error_message||""));return}
    info=d.data||{};st("Conta escolhida. Finalizando…")}catch(x){}
});
function st(t){document.getElementById("st").textContent=t}
window.fbAsyncInit=function(){FB.init({appId:${JSON.stringify(appId)},autoLogAppEvents:true,xfbml:false,version:${JSON.stringify(GRAPH)}})};
document.getElementById("go").addEventListener("click",function(){
  FB.login(function(r){
    if(!r.authResponse||!r.authResponse.code){st("Conexão não concluída.");return}
    setTimeout(function(){
      fetch("/api/wa-connect",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Requested-With":"lumera-crm"},body:JSON.stringify({code:r.authResponse.code,waba_id:info.waba_id,phone_number_id:info.phone_number_id})})
      .then(function(x){return x.json()}).then(function(j){var o=document.getElementById("out");o.hidden=false;o.textContent=JSON.stringify(j,null,2);st(j.ok?"Conectado. As mensagens novas já entram no CRM.":"Não conectou: "+(j.error||""))});
    },800);
  },{config_id:${JSON.stringify(configId)},response_type:"code",override_default_response_type:true,extras:{setup:{},featureType:"whatsapp_business_app_onboarding",sessionInfoVersion:"3"}});
});
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/pt_BR/sdk.js"></script>
</body></html>`);
}
