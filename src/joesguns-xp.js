import { getAllServerNames } from './helpers.js';

const WORKER = 'grow.js';
const TARGET = 'joesguns';
const REFILL_INTERVAL = 1000;

/**
 * Continuously fills the free RAM on every rooted server with grow operations
 * against joesguns. Existing processes are left alone; their RAM is used as it
 * becomes available.
 *
 * Usage: run joesguns-xp.js
 *
 * @param {NS} ns - The Netscript environment.
 */
export async function main(ns) {
  ns.disableLog('exec');
  ns.disableLog('getServerMaxRam');
  ns.disableLog('getServerUsedRam');
  ns.disableLog('scan');
  ns.disableLog('scp');
  ns.disableLog('sleep');

  if (!ns.serverExists(TARGET) || !ns.hasRootAccess(TARGET)) {
    ns.tprint(`ERROR: Root access to ${TARGET} is required.`);
    return;
  }

  const workerRam = ns.getScriptRam(WORKER, 'home');
  if (workerRam <= 0) {
    ns.tprint(`ERROR: ${WORKER} does not exist on home.`);
    return;
  }

  const servers = getAllServerNames(ns);
  let batch = 0;

  ns.tprint(`Starting grow XP farm on ${TARGET} using ${servers.length} connected servers.`);

  while (true) {
    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue;

      if (!ns.fileExists(WORKER, server)) {
        const copied = await ns.scp(WORKER, server, 'home');
        if (!copied) {
          ns.print(`WARN: Could not copy ${WORKER} to ${server}.`);
          continue;
        }
      }

      const freeRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
      const threads = Math.floor(freeRam / workerRam);
      if (threads <= 0) continue;

      // The unique final argument lets multiple grow.js batches coexist on a
      // server while other processes finish and release additional RAM.
      const batchId = `${Date.now()}-${batch++}`;
      const pid = ns.exec(WORKER, server, threads, TARGET, false, 0, batchId);
      if (pid === 0) {
        ns.print(`WARN: Failed to start ${threads} grow threads on ${server}.`);
      }
    }

    await ns.sleep(REFILL_INTERVAL);
  }
}
