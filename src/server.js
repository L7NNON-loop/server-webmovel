import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {
  requestCode,
  verifyCode,
  sendMessage,
  replyMessage,
  fetchDialogs,
  readMessages,
  markAsRead,
  sendBulkMessages,
  listGroups,
  listGroupMembers,
  broadcastGroups,
  removeSession
} from './telegramService.js';
import { listSessions } from './sessionStore.js';
import {
  listCommands,
  upsertCommand,
  deleteCommand,
  addAutoReply,
  registerWebhook,
  listAutoReplies
} from './automationStore.js';
import { addLog, listLogs } from './logStore.js';

const app = express();

const startedAt = Date.now();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const corsOrigins = (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim());
const apiKey = process.env.API_KEY || 'webmovel';

const rateLimitBucket = new Map();
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw createError(400, `Missing required fields: ${missing.join(', ')}`);
  }
}

function applyRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const current = rateLimitBucket.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  current.count += 1;
  rateLimitBucket.set(ip, current);

  if (current.count > RATE_LIMIT_MAX) {
    next(createError(429, 'Rate limit exceeded. Try again later.'));
    return;
  }

  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(RATE_LIMIT_MAX - current.count, 0)));
  res.setHeader('X-RateLimit-Reset', String(current.resetAt));
  next();
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(createError(403, 'Origin is not allowed by CORS policy'));
    }
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(applyRateLimit);

app.use((req, _res, next) => {
  const incoming = req.headers['x-api-key'];
  if (incoming !== apiKey) {
    next(createError(401, 'Unauthorized'));
    return;
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    addLog({
      endpoint: req.originalUrl,
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start
    });
  });
  next();
});

const serviceLogger = (entry) => addLog(entry);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'telegram-automation-api', uptime: Date.now() - startedAt });
});

app.post('/v1/auth/request-code', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['phoneNumber']);
    const result = await requestCode(req.body.phoneNumber);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/v1/auth/verify-code', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['phoneNumber', 'code', 'phoneCodeHash']);
    const result = await verifyCode({ ...req.body, logger: serviceLogger });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/v1/sessions', async (_req, res, next) => {
  try {
    const sessions = await listSessions();
    res.json({ items: sessions });
  } catch (error) {
    next(error);
  }
});

app.delete('/v1/sessions/:sessionId', async (req, res, next) => {
  try {
    const result = await removeSession(req.params.sessionId);
    if (!result.removed) {
      throw createError(404, 'SessionId inválido');
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/dialogs', async (req, res, next) => {
  try {
    validateRequiredFields(req.query, ['sessionId']);
    const items = await fetchDialogs(
      String(req.query.sessionId),
      Number.parseInt(String(req.query.limit || '20'), 10),
      serviceLogger
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/groups', async (req, res, next) => {
  try {
    validateRequiredFields(req.query, ['sessionId']);
    const items = await listGroups(String(req.query.sessionId), serviceLogger);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/groups/members', async (req, res, next) => {
  try {
    validateRequiredFields(req.query, ['sessionId', 'groupId']);
    const members = await listGroupMembers({
      sessionId: String(req.query.sessionId),
      groupId: String(req.query.groupId),
      limit: Number.parseInt(String(req.query.limit || '100'), 10),
      logger: serviceLogger
    });
    res.json({ members });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/messages', async (req, res, next) => {
  try {
    validateRequiredFields(req.query, ['sessionId', 'peer']);
    const items = await readMessages({
      sessionId: String(req.query.sessionId),
      peer: String(req.query.peer),
      limit: Number.parseInt(String(req.query.limit || '20'), 10),
      logger: serviceLogger
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/messages/send', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'peer', 'message']);
    const result = await sendMessage({ ...req.body, logger: serviceLogger });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/v1/messages/reply', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'peer', 'message', 'replyToMsgId']);
    const result = await replyMessage({ ...req.body, logger: serviceLogger });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/v1/messages/read', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'peer']);
    const result = await markAsRead({ ...req.body, logger: serviceLogger });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/v1/messages/bulk', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'peers', 'message']);
    if (!Array.isArray(req.body.peers) || req.body.peers.length === 0) {
      throw createError(400, 'peers must be a non-empty array');
    }
    const items = await sendBulkMessages({ ...req.body, logger: serviceLogger });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/messages/broadcast-groups', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'message']);
    const result = await broadcastGroups({ ...req.body, logger: serviceLogger });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/v1/comandos', async (_req, res, next) => {
  try {
    const items = await listCommands();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/comandos', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['comando', 'resposta']);
    await upsertCommand(req.body.comando, req.body.resposta);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/v1/comandos/:comando', async (req, res, next) => {
  try {
    const removed = await deleteCommand(decodeURIComponent(req.params.comando));
    if (!removed) {
      throw createError(404, 'Comando não encontrado');
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/automation/auto-reply', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'trigger', 'reply']);
    await addAutoReply(req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/automation/auto-reply', async (_req, res, next) => {
  try {
    const items = await listAutoReplies();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/webhook/register', async (req, res, next) => {
  try {
    validateRequiredFields(req.body, ['sessionId', 'url']);
    await registerWebhook(req.body.sessionId, req.body.url);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/logs', (req, res) => {
  const limit = Number.parseInt(String(req.query.limit || '200'), 10);
  const items = listLogs(limit);
  res.json({ items });
});

app.use((error, req, res, _next) => {
  const status = error.status || 500;
  const message = error.message || 'Internal Server Error';

  addLog({
    endpoint: req.originalUrl,
    method: req.method,
    status,
    error: message
  });

  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`Telegram automation API running on port ${port}`);
});
