import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_STORE_PATH = path.resolve(process.cwd(), process.env.SESSION_STORE_PATH || 'data/sessions.json');

async function ensureStoreFile(filePath = DEFAULT_STORE_PATH) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ sessions: {} }, null, 2), 'utf8');
  }
}

async function readStore(filePath = DEFAULT_STORE_PATH) {
  await ensureStoreFile(filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeStore(content, filePath = DEFAULT_STORE_PATH) {
  await ensureStoreFile(filePath);
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
}

export async function saveSession(sessionId, sessionString) {
  const db = await readStore();
  db.sessions[sessionId] = {
    sessionString,
    updatedAt: new Date().toISOString()
  };
  await writeStore(db);
}

export async function getSession(sessionId) {
  const db = await readStore();
  return db.sessions[sessionId] || null;
}

export async function deleteSession(sessionId) {
  const db = await readStore();
  if (!db.sessions[sessionId]) {
    return false;
  }
  delete db.sessions[sessionId];
  await writeStore(db);
  return true;
}

export async function listSessions() {
  const db = await readStore();
  return Object.entries(db.sessions).map(([sessionId, value]) => ({
    sessionId,
    updatedAt: value.updatedAt
  }));
}
