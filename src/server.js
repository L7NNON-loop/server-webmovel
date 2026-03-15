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
  markAsRead
} from './telegramService.js';
import { listSessions } from './sessionStore.js';

const app = express();

const port = Number.parseInt(process.env.PORT || '3000', 10);
const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map((origin) => origin.trim());
const apiKey = process.env.API_KEY || '';

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS policy'));
    }
  })
);
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (!apiKey) {
    next();
    return;
  }

  const incoming = req.headers['x-api-key'];
  if (incoming !== apiKey) {
    res.status(401).json({ error: 'Unauthorized: invalid x-api-key' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'telegram-automation-api' });
});

app.post('/v1/auth/request-code', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'phoneNumber is required' });
      return;
    }

    const result = await requestCode(phoneNumber);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/auth/verify-code', async (req, res) => {
  try {
    const { phoneNumber, code, phoneCodeHash, password } = req.body;
    if (!phoneNumber || !code || !phoneCodeHash) {
      res.status(400).json({ error: 'phoneNumber, code and phoneCodeHash are required' });
      return;
    }

    const result = await verifyCode({ phoneNumber, code, phoneCodeHash, password });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/sessions', async (_req, res) => {
  try {
    const sessions = await listSessions();
    res.json({ items: sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/dialogs', async (req, res) => {
  try {
    const { sessionId, limit } = req.query;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const items = await fetchDialogs(String(sessionId), Number.parseInt(String(limit || '20'), 10));
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/messages/send', async (req, res) => {
  try {
    const { sessionId, peer, message, replyToMsgId } = req.body;
    if (!sessionId || !peer || !message) {
      res.status(400).json({ error: 'sessionId, peer and message are required' });
      return;
    }

    const result = await sendMessage({ sessionId, peer, message, replyToMsgId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/messages/reply', async (req, res) => {
  try {
    const { sessionId, peer, message, replyToMsgId } = req.body;
    if (!sessionId || !peer || !message || !replyToMsgId) {
      res.status(400).json({ error: 'sessionId, peer, message and replyToMsgId are required' });
      return;
    }

    const result = await replyMessage({ sessionId, peer, message, replyToMsgId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/messages', async (req, res) => {
  try {
    const { sessionId, peer, limit } = req.query;
    if (!sessionId || !peer) {
      res.status(400).json({ error: 'sessionId and peer are required' });
      return;
    }

    const items = await readMessages({
      sessionId: String(sessionId),
      peer: String(peer),
      limit: Number.parseInt(String(limit || '20'), 10)
    });

    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/messages/read', async (req, res) => {
  try {
    const { sessionId, peer, maxId } = req.body;
    if (!sessionId || !peer) {
      res.status(400).json({ error: 'sessionId and peer are required' });
      return;
    }

    const result = await markAsRead({ sessionId, peer, maxId: Number(maxId || 0) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err.message.includes('CORS')) {
    res.status(403).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Telegram automation API running on port ${port}`);
});
