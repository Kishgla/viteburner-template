import { getAllServerNames } from '../helpers.js';

const TARGET = 'joesguns';
const WORKER = 'weaken.js';
const SECURITY_TOLERANCE = 0.000001;

/**
 * Uses available RAM across all rooted servers to reduce joesguns to minimum
 * security as quickly as the available weaken capacity permits.
 *
 * Usage: run joesguns-weaken.js
 *
 * @param {NS} ns - The Netscript environment.
 */
export async function main(ns) {
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

  let wave = 0;
  while (true) {
    const security = ns.getServerSecurityLevel(TARGET);
    const minimum = ns.getServerMinSecurityLevel(TARGET);
    let remainingReduction = security - minimum;

    if (remainingReduction <= SECURITY_TOLERANCE) {
      ns.tprint(
        `${TARGET} is at minimum security (${ns.format.number(security, 3)}).`,
      );
      return;
    }

    wave++;
    const pids = [];
    const servers = getAllServerNames(ns);

    ns.tprint(
      `Weaken wave ${wave}: ${ns.format.number(security, 3)} security; ` +
        `${ns.format.number(remainingReduction, 3)} reduction needed.`,
    );

    for (const server of servers) {
      if (!ns.hasRootAccess(server) || remainingReduction <= 0) continue;

      if (!ns.fileExists(WORKER, server)) {
        const copied = await ns.scp(WORKER, server, 'home');
        if (!copied) {
          ns.print(`WARN: Could not copy ${WORKER} to ${server}.`);
          continue;
        }
      }

      const freeRam =
        ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
      const availableThreads = Math.floor(freeRam / workerRam);
      if (availableThreads <= 0) continue;

      const cores = ns.getServer(server).cpuCores;
      const reductionPerThread = ns.weakenAnalyze(1, cores);
      const neededThreads = Math.ceil(remainingReduction / reductionPerThread);
      const threads = Math.min(availableThreads, neededThreads);
      const batchId = `joesguns-weaken-${wave}-${server}-${Date.now()}`;
      const pid = ns.exec(WORKER, server, threads, TARGET, false, 0, batchId);

      if (pid === 0) {
        ns.print(`WARN: Failed to start ${threads} threads on ${server}.`);
        continue;
      }

      pids.push({ pid, server });
      remainingReduction -= ns.weakenAnalyze(threads, cores);
    }

    if (pids.length === 0) {
      ns.tprint('WARN: No RAM is currently available; retrying in 1 second.');
      await ns.sleep(1000);
      continue;
    }

    while (pids.some(({ pid, server }) => ns.isRunning(pid, server))) {
      await ns.sleep(100);
    }
  }
}