# Telegram Automation API (Render / Railway / Cloudflare-ready)

Servidor Node.js pronto para automação com Telegram usando MTProto (biblioteca `telegram`/GramJS), com endpoints para:

- iniciar login por código
- confirmar login e salvar sessão
- listar sessões salvas
- enviar mensagens
- responder mensagens
- ler mensagens e marcar como lidas

> **Importante sobre credenciais:** eu não deixei `api_id`/`api_hash` fixos no código. Tudo entra por variável de ambiente para segurança e para facilitar troca de ambiente depois.

---

## 1) Requisitos

- Node.js 20+
- NPM 10+

---

## 2) Configurar ambiente

```bash
cp .env.example .env
```

Edite o `.env`:

```env
PORT=3000
API_KEY=uma-chave-forte
CORS_ORIGINS=https://seu-frontend.com,http://localhost:5173
TELEGRAM_API_ID=SEU_API_ID
TELEGRAM_API_HASH=SEU_API_HASH
SESSION_STORE_PATH=data/sessions.json
```

### Variáveis

- `PORT`: porta HTTP do servidor.
- `API_KEY`: chave obrigatória enviada no header `x-api-key`.
- `CORS_ORIGINS`: origens permitidas (separadas por vírgula) para frontends externos.
- `TELEGRAM_API_ID` e `TELEGRAM_API_HASH`: credenciais da app Telegram.
- `SESSION_STORE_PATH`: caminho onde as sessões serão persistidas.

---

## 3) Rodar local

```bash
npm install
npm run dev
```

Healthcheck:

```bash
curl http://localhost:3000/health
```

---

## 4) Fluxo de autenticação Telegram

### 4.1 Pedir código SMS/Telegram

```bash
curl -X POST http://localhost:3000/v1/auth/request-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_API_KEY" \
  -d '{"phoneNumber":"+5511999999999"}'
```

Retorna `sessionId` + `phoneCodeHash`.

### 4.2 Confirmar código

```bash
curl -X POST http://localhost:3000/v1/auth/verify-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_API_KEY" \
  -d '{
    "phoneNumber":"+5511999999999",
    "code":"12345",
    "phoneCodeHash":"valor_retornado_no_passo_anterior"
  }'
```

Se sua conta tiver 2FA, envie também `password`.

---

## 5) Endpoints principais

### `GET /health`
Status do serviço.

### `POST /v1/auth/request-code`
Inicia login e solicita código.

### `POST /v1/auth/verify-code`
Confirma código e salva sessão.

### `GET /v1/sessions`
Lista sessões já persistidas.

### `GET /v1/dialogs?sessionId=...&limit=20`
Lista conversas/chats.

### `POST /v1/messages/send`
Envia mensagem.

Body:

```json
{
  "sessionId": "phone:+5511999999999",
  "peer": "username_ou_id",
  "message": "Olá!"
}
```

### `POST /v1/messages/reply`
Responde mensagem específica.

### `GET /v1/messages?sessionId=...&peer=...&limit=20`
Lê histórico de mensagens.

### `POST /v1/messages/read`
Marca mensagens como lidas.

---

## 6) Deploy em cloud

## Render

1. Suba este repositório no GitHub.
2. No Render, crie um **Web Service** usando `render.yaml`.
3. Configure variáveis secretas:
   - `API_KEY`
   - `CORS_ORIGINS`
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`

## Railway

1. Novo projeto -> Deploy from GitHub.
2. Railway detecta `railway.json` + `Dockerfile`.
3. Defina variáveis de ambiente no painel.

## Cloudflare

Para automação Telegram MTProto, o recomendado é rodar em container/VM (Render/Railway) e usar Cloudflare como camada de DNS/proxy/WAF na frente.

- A API fica no domínio (ou subdomínio) atrás da Cloudflare.
- CORS + `x-api-key` já está preparado neste backend.

---

## 7) Segurança recomendada (produção)

- Trocar `API_KEY` por token robusto (32+ chars).
- Limitar `CORS_ORIGINS` para seus domínios reais.
- Usar HTTPS sempre.
- Opcional: adicionar rate-limit + logs estruturados + banco criptografado para sessões.

---

## 8) Próximos passos sugeridos

- Webhook de eventos (mensagem nova, status etc.)
- Filas (BullMQ/Redis) para tarefas de envio em massa com controle
- Multi-tenant (várias contas/clientes)
- Painel admin para visualizar sessões e histórico
