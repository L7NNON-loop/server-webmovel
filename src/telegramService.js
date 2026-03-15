import axios from 'axios';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { saveSession, getSession, deleteSession } from './sessionStore.js';
import {
  getCommandReply,
  listAutoReplies,
  getWebhook
} from './automationStore.js';

const activeClients = new Map();
const pendingLogins = new Map();
const listenersInstalled = new Set();

function getApiCredentials() {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || '', 10);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    throw new Error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in environment variables');
  }

  return { apiId, apiHash };
}

function buildSessionId(phoneNumber) {
  return `phone:${phoneNumber.replace(/\s+/g, '')}`;
}

function formatTemplate(template, sender = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return String(template)
    .replaceAll('{firstName}', sender.firstName || '')
    .replaceAll('{username}', sender.username || '')
    .replaceAll('{phone}', sender.phone || '')
    .replaceAll('{date}', today);
}

async function postWebhookEvent(sessionId, payload) {
  const hook = await getWebhook(sessionId);
  if (!hook?.url) {
    return;
  }

  await axios.post(hook.url, payload, {
    timeout: 8000,
    headers: { 'Content-Type': 'application/json' }
  });
}

function installClientListener(sessionId, client, logger) {
  if (listenersInstalled.has(sessionId)) {
    return;
  }

  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      const text = message?.message || '';
      const peerId = message?.peerId;
      const peer = String(peerId?.userId || peerId?.chatId || peerId?.channelId || '');

      await postWebhookEvent(sessionId, {
        event: 'new_message',
        sessionId,
        peer,
        text,
        date: message?.date
      });

      const sender = await message.getSender().catch(() => null);
      const senderMeta = {
        firstName: sender?.firstName,
        username: sender?.username,
        phone: sender?.phone
      };

      if (text.startsWith('/')) {
        const commandKey = text.split(' ')[0].trim();
        const cmdReply = await getCommandReply(commandKey);
        if (cmdReply) {
          await client.sendMessage(message.peerId, {
            message: formatTemplate(cmdReply, senderMeta),
            replyTo: message.id
          });
        }
      }

      const autoReplies = await listAutoReplies();
      const rule = autoReplies.find((r) => text.toLowerCase().includes(String(r.trigger || '').toLowerCase()));
      if (rule) {
        await client.sendMessage(message.peerId, {
          message: formatTemplate(rule.reply, senderMeta),
          replyTo: message.id
        });
      }
    } catch (error) {
      logger?.({ endpoint: 'event:new_message', method: 'INTERNAL', status: 500, error: error.message });
    }
  }, new NewMessage({}));

  listenersInstalled.add(sessionId);
}

export async function requestCode(phoneNumber) {
  const { apiId, apiHash } = getApiCredentials();
  const sessionId = buildSessionId(phoneNumber);

  const existing = await getSession(sessionId);
  const stringSession = new StringSession(existing?.sessionString || '');

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();

  const result = await client.sendCode({ apiId, apiHash }, phoneNumber);

  pendingLogins.set(sessionId, {
    phoneCodeHash: result.phoneCodeHash,
    client,
    phoneNumber,
    createdAt: Date.now()
  });

  activeClients.set(sessionId, client);

  return {
    sessionId,
    phoneCodeHash: result.phoneCodeHash,
    type: result.type?.className || 'sentCode'
  };
}

export async function verifyCode({ phoneNumber, code, phoneCodeHash, password, logger }) {
  const sessionId = buildSessionId(phoneNumber);
  const pending = pendingLogins.get(sessionId);

  if (!pending) {
    throw new Error('No pending login for this phone number. Call /v1/auth/request-code first');
  }

  if (pending.phoneCodeHash !== phoneCodeHash) {
    throw new Error('phoneCodeHash mismatch');
  }

  await pending.client.start({
    phoneNumber: async () => phoneNumber,
    phoneCode: async () => code,
    phoneCodeHash: async () => phoneCodeHash,
    password: async () => password || '',
    onError: (err) => {
      throw err;
    }
  });

  const me = await pending.client.getMe();
  const sessionString = pending.client.session.save();

  await saveSession(sessionId, sessionString);
  pendingLogins.delete(sessionId);
  activeClients.set(sessionId, pending.client);
  installClientListener(sessionId, pending.client, logger);

  return {
    sessionId,
    user: {
      id: me.id,
      username: me.username,
      firstName: me.firstName,
      lastName: me.lastName,
      phone: me.phone
    },
    saved: true
  };
}

export async function getClientBySessionId(sessionId, logger) {
  if (activeClients.has(sessionId)) {
    return activeClients.get(sessionId);
  }

  const { apiId, apiHash } = getApiCredentials();
  const saved = await getSession(sessionId);

  if (!saved?.sessionString) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const client = new TelegramClient(new StringSession(saved.sessionString), apiId, apiHash, {
    connectionRetries: 5
  });
  await client.connect();
  activeClients.set(sessionId, client);
  installClientListener(sessionId, client, logger);
  return client;
}

async function withRetry(fn, retries = 3, delayMs = 1200) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

export async function sendMessage({ sessionId, peer, message, replyToMsgId, logger }) {
  const client = await getClientBySessionId(sessionId, logger);

  const sent = await withRetry(() =>
    client.sendMessage(peer, {
      message,
      replyTo: replyToMsgId
    })
  );

  await postWebhookEvent(sessionId, {
    event: 'message_sent',
    sessionId,
    peer: String(peer),
    text: message,
    date: sent.date
  }).catch(() => null);

  return {
    id: sent.id,
    date: sent.date,
    peerId: String(sent.peerId?.userId || sent.peerId?.chatId || sent.peerId?.channelId || peer)
  };
}

export async function sendBulkMessages({ sessionId, peers, message, logger }) {
  const results = [];
  for (const peer of peers) {
    const result = await sendMessage({ sessionId, peer, message, logger });
    results.push({ peer, ok: true, result });
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return results;
}

export async function fetchDialogs(sessionId, limit = 20, logger) {
  const client = await getClientBySessionId(sessionId, logger);
  const dialogs = await client.getDialogs({ limit });

  return dialogs.map((dialog) => ({
    id: String(dialog.id),
    title: dialog.title,
    unreadCount: dialog.unreadCount,
    isUser: Boolean(dialog.isUser),
    isGroup: Boolean(dialog.isGroup),
    isChannel: Boolean(dialog.isChannel)
  }));
}

export async function listGroups(sessionId, logger) {
  const dialogs = await fetchDialogs(sessionId, 200, logger);
  return dialogs.filter((d) => d.isGroup || d.isChannel);
}

export async function listGroupMembers({ sessionId, groupId, limit = 100, logger }) {
  const client = await getClientBySessionId(sessionId, logger);
  const participants = await client.getParticipants(groupId, { limit });
  return participants.map((p) => ({
    id: p.id,
    username: p.username,
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone
  }));
}

export async function broadcastGroups({ sessionId, message, logger }) {
  const groups = await listGroups(sessionId, logger);
  const peers = groups.map((g) => g.id);
  const sent = await sendBulkMessages({ sessionId, peers, message, logger });
  return { totalGroups: groups.length, sent };
}

export async function replyMessage({ sessionId, peer, message, replyToMsgId, logger }) {
  if (!replyToMsgId) {
    throw new Error('replyToMsgId is required');
  }
  return sendMessage({ sessionId, peer, message, replyToMsgId, logger });
}

export async function readMessages({ sessionId, peer, limit = 20, logger }) {
  const client = await getClientBySessionId(sessionId, logger);

  const messages = await client.getMessages(peer, { limit });

  return messages.map((msg) => ({
    id: msg.id,
    text: msg.message,
    date: msg.date,
    out: msg.out,
    fromId: String(msg.fromId?.userId || msg.fromId?.channelId || msg.fromId?.chatId || '')
  }));
}

export async function markAsRead({ sessionId, peer, maxId, logger }) {
  const client = await getClientBySessionId(sessionId, logger);

  await client.invoke(
    new Api.messages.ReadHistory({
      peer,
      maxId: maxId || 0
    })
  );

  return { ok: true };
}

export async function removeSession(sessionId) {
  const client = activeClients.get(sessionId);
  if (client) {
    await client.disconnect();
    activeClients.delete(sessionId);
    listenersInstalled.delete(sessionId);
  }

  const removed = await deleteSession(sessionId);
  return { removed };
}
