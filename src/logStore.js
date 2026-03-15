const MAX_LOGS = 2000;
const logs = [];

export function addLog(entry) {
  logs.push({ timestamp: new Date().toISOString(), ...entry });
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

export function listLogs(limit = 200) {
  return logs.slice(-Math.max(1, Math.min(limit, MAX_LOGS))).reverse();
}
