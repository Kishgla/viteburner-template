export const SCHEDULER = 'dynamic-hack-scheduler.js';
export const WORKERS = new Set(['hack.js', 'grow.js', 'weaken.js']);

export function readSnapshot(ns, port) {
  const value = ns.peek(port);
  if (value === 'NULL PORT DATA') return null;
  try {
    const snapshot = JSON.parse(String(value));
    return Array.isArray(snapshot.batches) ? snapshot : null;
  } catch {
    return null;
  }
}

export function scanNetwork(ns) {
  const visited = new Set(['home']);
  const pending = ['home'];
  while (pending.length > 0) {
    const host = pending.shift();
    for (const neighbor of ns.scan(host)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return [...visited];
}

export function findWorkerProcesses(ns, hosts = scanNetwork(ns)) {
  const processes = [];
  for (const host of hosts) {
    for (const process of ns.ps(host)) {
      if (WORKERS.has(process.filename)) processes.push({ host, ...process });
    }
  }
  return processes;
}

export function trackedJobs(snapshot) {
  return snapshot.batches.flatMap((batch) =>
    batch.operations.map((operation) => ({ batchId: batch.id, target: batch.target, ...operation })),
  );
}

export function processKey(host, pid) {
  return `${host}:${pid}`;
}

export async function waitForSnapshot(ns, port, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = readSnapshot(ns, port);
    if (snapshot && predicate(snapshot)) return snapshot;
    await ns.sleep(100);
  }
  return null;
}

export function batchesForTarget(snapshot, target) {
  return snapshot.batches.filter((batch) => target === null || batch.target === target);
}
