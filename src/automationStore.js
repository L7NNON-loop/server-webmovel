import { promises as fs } from 'node:fs';
import path from 'node:path';

const STORE_PATH = path.resolve(process.cwd(), process.env.AUTOMATION_STORE_PATH || 'data/automation.json');

async function ensureStore() {
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(
      STORE_PATH,
      JSON.stringify({ commands: {}, autoReplies: [], webhooks: {} }, null, 2),
      'utf8'
    );
  }
}

async function readStore() {
  await ensureStore();
  const content = await fs.readFile(STORE_PATH, 'utf8');
  return JSON.parse(content);
}

async function writeStore(data) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export async function listCommands() {
  const db = await readStore();
  return Object.entries(db.commands).map(([command, reply]) => ({ command, reply }));
}

export async function upsertCommand(command, reply) {
  const db = await readStore();
  db.commands[command.trim()] = reply;
  await writeStore(db);
}

export async function deleteCommand(command) {
  const db = await readStore();
  const key = command.trim();
  if (!db.commands[key]) {
    return false;
  }
  delete db.commands[key];
  await writeStore(db);
  return true;
}

export async function getCommandReply(command) {
  const db = await readStore();
  return db.commands[command.trim()] || null;
}

export async function addAutoReply(rule) {
  const db = await readStore();
  db.autoReplies.push(rule);
  await writeStore(db);
}

export async function listAutoReplies() {
  const db = await readStore();
  return db.autoReplies;
}

export async function registerWebhook(sessionId, url) {
  const db = await readStore();
  db.webhooks[sessionId] = { url, updatedAt: new Date().toISOString() };
  await writeStore(db);
}

export async function getWebhook(sessionId) {
  const db = await readStore();
  return db.webhooks[sessionId] || null;
}
