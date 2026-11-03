# Luméra Odontologia — site + CRM

Site estático com funções na Vercel.

| Caminho | O que é |
|---|---|
| `/` (`index.html`) | Site da clínica. Os botões de WhatsApp geram um código (`cód. L…`) e registram o lead com UTMs, fbclid e cookies do Meta |
| `/crm` | CRM em funil (Novo → Conversando → Agendou → Compareceu → Fechou / Perdido), relatório por campanha e gerador de UTM |
| `/api/lead` | Registro automático do clique no site (público) |
| `/api/webhook` | Entrada de leads externos (Zapier, Make, n8n, ferramenta de WhatsApp). Chave em `?key=` ou `X-Webhook-Key` |
| `/api/leads` | API interna do CRM (`X-CRM-Key`) |
| `config.js` | ID do Pixel e WhatsApp usados no site |

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Para quê |
|---|---|---|
| `CRM_KEY` | sim | Senha do `/crm` |
| `WEBHOOK_KEY` | não | Chave própria do webhook (se faltar, usa `CRM_KEY`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | sim | Banco Upstash Redis. São criadas sozinhas ao conectar o Upstash em Storage |
| `META_CAPI_TOKEN` | recomendada | Token da API de Conversões. Envia Lead, Schedule e Purchase ao Pixel quando o lead muda de etapa |
| `META_PIXEL_ID` | não | Padrão `1127167810011936` |
| `META_TEST_EVENT_CODE` | não | Para testar eventos no Gerenciador de Eventos |

## Fotos
Coloque `assets/michele-hero.jpg` (topo) e `assets/michele-sobre.jpg` (seção Sobre). Sem elas, a moldura mostra o logo.

## Links de anúncio
Parâmetros de URL no Meta:
`utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}`

Acrescente `&t=implante`, `&t=clareamento` ou `&t=prevencao` para o botão principal abrir no assunto certo.
