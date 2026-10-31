const WORKER = 'utility-scripts/ram-pressure-worker.js';

function scanNetwork(ns) {
  const hosts = ['home'];
  const visited = new Set(hosts);
  for (let i = 0; i < hosts.length; i++) {
    for (const neighbor of ns.scan(hosts[i])) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      hosts.push(neighbor);
    }
  }
  return hosts;
}

/**
 * Temporarily occupy worker RAM so the scheduler must reject an atomic batch.
 * Usage: run utility-scripts/atomic-dispatch-ram-pressure.js [duration=150000] [homeReserveGb=16]
 * Stop this controller at any time to kill only the pressure workers it launched.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const duration = Math.max(1_000, Number(ns.args[0] ?? 150_000));
  const homeReserve = Math.max(4, Number(ns.args[1] ?? 16));
  const deadline = Date.now() + duration;
  const token = `atomic-pressure-${ns.pid}-${Date.now()}`;
  const launched = [];
  let sequence = 0;

  const cleanup = () => {
    for (const process of launched) ns.kill(process.pid, process.host);
  };
  ns.atExit(cleanup);

  const hosts = scanNetwork(ns).filter((host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0);
  for (const host of hosts) {
    if (host !== 'home') ns.scp(WORKER, host, 'home');
  }

  ns.tprint(`Applying atomic-dispatch RAM pressure for ${Math.ceil(duration / 1_000)} seconds.`);
  try {
    while (Date.now() < deadline) {
      const workerRam = ns.getScriptRam(WORKER, 'home');
      for (const host of hosts) {
        const reserve = host === 'home' ? homeReserve : 0;
        const available = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
        const threads = Math.floor(available / workerRam);
        if (threads <= 0) continue;
        sequence += 1;
        const pid = ns.exec(WORKER, host, threads, token, sequence);
        if (pid !== 0) launched.push({ pid, host });
      }
      await ns.sleep(20);
    }
  } finally {
    cleanup();
  }
  ns.tprint(`Released ${launched.length} RAM-pressure process(es).`);
}
