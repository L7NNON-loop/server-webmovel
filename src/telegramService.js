import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import { saveSession, getSession } from './sessionStore.js';

const activeClients = new Map();
const pendingLogins = new Map();

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

export async function requestCode(phoneNumber) {
  const { apiId, apiHash } = getApiCredentials();
  const sessionId = buildSessionId(phoneNumber);

  const existing = await getSession(sessionId);
  const stringSession = new StringSession(existing?.sessionString || '');

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();

  const result = await client.sendCode(
    {
      apiId,
      apiHash
    },
    phoneNumber
  );

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

export async function verifyCode({ phoneNumber, code, phoneCodeHash, password }) {
  const sessionId = buildSessionId(phoneNumber);
  const pending = pendingLogins.get(sessionId);

  if (!pending) {
    throw new Error('No pending login for this phone number. Call /v1/auth/request-code first');
  }

  if (pending.phoneCodeHash !== phoneCodeHash) {
    throw new Error('phoneCodeHash mismatch');
  }

  const { apiId, apiHash } = getApiCredentials();

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

  return {
    sessionId,
    user: {
      id: me.id,
      username: me.username,
      firstName: me.firstName,
      lastName: me.lastName,
      phone: me.phone
    },
    saved: true,
    apiIdUsed: apiId,
    apiHashConfigured: Boolean(apiHash)
  };
}

export async function getClientBySessionId(sessionId) {
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
  return client;
}

export async function sendMessage({ sessionId, peer, message, replyToMsgId }) {
  const client = await getClientBySessionId(sessionId);

  const sent = await client.sendMessage(peer, {
    message,
    replyTo: replyToMsgId
  });

  return {
    id: sent.id,
    date: sent.date,
    peerId: String(sent.peerId?.userId || sent.peerId?.chatId || sent.peerId?.channelId || peer)
  };
}

export async function fetchDialogs(sessionId, limit = 20) {
  const client = await getClientBySessionId(sessionId);
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

export async function replyMessage({ sessionId, peer, message, replyToMsgId }) {
  if (!replyToMsgId) {
    throw new Error('replyToMsgId is required');
  }
  return sendMessage({ sessionId, peer, message, replyToMsgId });
}

export async function readMessages({ sessionId, peer, limit = 20 }) {
  const client = await getClientBySessionId(sessionId);

  const messages = await client.getMessages(peer, { limit });

  return messages.map((msg) => ({
    id: msg.id,
    text: msg.message,
    date: msg.date,
    out: msg.out,
    fromId: String(msg.fromId?.userId || msg.fromId?.channelId || msg.fromId?.chatId || '')
  }));
}

export async function markAsRead({ sessionId, peer, maxId }) {
  const client = await getClientBySessionId(sessionId);

  await client.invoke(
    new Api.messages.ReadHistory({
      peer,
      maxId: maxId || 0
    })
  );

  return { ok: true };
}
