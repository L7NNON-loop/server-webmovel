# WebMovel Telegram Automation API

Backend avançado de automação Telegram (GramJS) pronto para Render/Railway e uso por dashboards, bots e integrações externas.

Base de produção atual: `https://server-webmovel.onrender.com`

## Segurança

- Todas as rotas exigem header `x-api-key`
- Rate limit padrão: `100` req/min por IP
- Erros estruturados em JSON
- CORS configurável por variável de ambiente

## Variáveis de ambiente

```env
API_KEY=webmovel
PORT=3000
CORS_ORIGIN=*
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=seu_api_hash
SESSION_STORE_PATH=data/sessions.json
AUTOMATION_STORE_PATH=data/automation.json
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

## Instalação

```bash
cp .env.example .env
npm install
npm run dev
```

## Health

`GET /health`

Resposta:

```json
{ "ok": true, "service": "telegram-automation-api", "uptime": 123456 }
```

## Autenticação Telegram

- `POST /v1/auth/request-code`
- `POST /v1/auth/verify-code`

## Sessões

- `GET /v1/sessions`
- `DELETE /v1/sessions/:sessionId`

## Diálogos e Grupos

- `GET /v1/dialogs?sessionId=...&limit=50`
- `GET /v1/groups?sessionId=...`
- `GET /v1/groups/members?sessionId=...&groupId=...&limit=100`

## Mensagens

- `GET /v1/messages?sessionId=...&peer=...&limit=50`
- `POST /v1/messages/send`
- `POST /v1/messages/reply`
- `POST /v1/messages/read`
- `POST /v1/messages/bulk`
- `POST /v1/messages/broadcast-groups`

Bulk e broadcast enviam em sequência com pausa para reduzir risco de flood.

## Comandos automáticos

- `GET /v1/comandos`
- `POST /v1/comandos`
- `DELETE /v1/comandos/:comando`

Formato:

```json
{ "comando": "/price", "resposta": "Preço atual: 10 USD" }
```

Variáveis suportadas nas respostas:

- `{firstName}`
- `{username}`
- `{phone}`
- `{date}`

## Auto reply por palavra-chave

- `POST /v1/automation/auto-reply`
- `GET /v1/automation/auto-reply`

Exemplo:

```json
{ "sessionId": "phone:+258...", "trigger": "price", "reply": "Confira nossa lista de preços" }
```

## Webhook

Registrar webhook por sessão:

- `POST /v1/webhook/register`

Eventos enviados:

- `new_message`
- `message_sent`

## Logs

- `GET /v1/logs?limit=200`

Campos:

- `timestamp`
- `endpoint`
- `method`
- `status`
- `durationMs`
- `error` (quando houver)

## Deploy

- Render: use `render.yaml`
- Railway: use `railway.json` + `Dockerfile`
- Cloudflare: recomendado usar como proxy/WAF em frente ao serviço
