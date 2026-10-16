import { getAllServerNames } from '../helpers.js';

const WORKERS = {
  grow: 'grow.js',
  hack: 'hack.js',
  weaken: 'weaken.js',
};
const SECURITY_BUFFER = 5;
const FUNDING_THRESHOLD = 0.95;
const MONEY_TARGET = 0.9;
const SECURITY_MARGIN = 0.1;

/**
 * Put a target into a state that exercises one of the scheduler's prep paths.
 * Stop the scheduler before running this script so it does not repair the state.
 *
 * Usage: run utility-scripts/prep-state-setup.js <target> <grow|weaken>
 *
 * `grow` leaves money below the scheduler's funding threshold while keeping
 * security within its buffer. `weaken` raises security beyond that buffer.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = String(ns.args[0] ?? '');
  const kind = String(ns.args[1] ?? '');

  if (!target || !['grow', 'weaken'].includes(kind)) {
    ns.tprint('Usage: run utility-scripts/prep-state-setup.js <target> <grow|weaken>');
    return;
  }
  if (!ns.serverExists(target) || !ns.hasRootAccess(target)) {
    ns.tprint(`ERROR: Root access to ${target} is required.`);
    return;
  }
  if (ns.getServerMaxMoney(target) <= 0) {
    ns.tprint(`ERROR: ${target} has no money and is not a valid scheduler target.`);
    return;
  }

  if (kind === 'grow') {
    await lowerSecurity(ns, target);
    await lowerMoney(ns, target);
    await lowerSecurity(ns, target);
  } else {
    await raiseSecurity(ns, target);
  }

  const server = ns.getServer(target);
  const moneyRatio = server.moneyAvailable / server.moneyMax;
  const securityDelta = server.hackDifficulty - server.minDifficulty;
  const ready =
    kind === 'grow'
      ? moneyRatio < FUNDING_THRESHOLD && securityDelta <= SECURITY_BUFFER
      : securityDelta > SECURITY_BUFFER;

  ns.tprint(
    `${ready ? 'READY' : 'FAIL'}: ${target} money=${ns.formatPercent(moneyRatio, 2)} ` +
      `security=${server.hackDifficulty.toFixed(3)} (min+${securityDelta.toFixed(3)}); ` +
      `expected prep kind=${kind}.`,
  );
  if (ready) {
    ns.tprint(`Start the scheduler, then run test-scripts/prep-id-test.js ${target} ${kind}`);
  }
}

async function lowerMoney(ns, target) {
  const maxMoney = ns.getServerMaxMoney(target);
  while (ns.getServerMoneyAvailable(target) >= maxMoney * FUNDING_THRESHOLD) {
    const current = ns.getServerMoneyAvailable(target);
    const amount = Math.max(1, current - maxMoney * MONEY_TARGET);
    const threads = Math.max(1, Math.ceil(ns.hackAnalyzeThreads(target, amount)));
    await dispatchWave(ns, 'hack', target, threads);
  }
}

async function lowerSecurity(ns, target) {
  while (ns.getServerSecurityLevel(target) > ns.getServerMinSecurityLevel(target) + SECURITY_BUFFER) {
    const reduction = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target);
    const threads = Math.max(1, Math.ceil(reduction / ns.weakenAnalyze(1)));
    await dispatchWave(ns, 'weaken', target, threads);
  }
}

async function raiseSecurity(ns, target) {
  const desired = ns.getServerMinSecurityLevel(target) + SECURITY_BUFFER + SECURITY_MARGIN;
  while (ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) + SECURITY_BUFFER) {
    const increase = desired - ns.getServerSecurityLevel(target);
    const threads = Math.max(1, Math.ceil(increase / ns.growthAnalyzeSecurity(1, target)));
    await dispatchWave(ns, 'grow', target, threads);
  }
}

async function dispatchWave(ns, operation, target, requestedThreads) {
  const worker = WORKERS[operation];
  const workerRam = ns.getScriptRam(worker, 'home');
  let remaining = requestedThreads;
  const launches = [];

  for (const host of getAllServerNames(ns)) {
    if (!ns.hasRootAccess(host) || remaining <= 0) continue;
    if (!ns.fileExists(worker, host) && !(await ns.scp(worker, host, 'home'))) continue;

    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    const threads = Math.min(remaining, Math.floor(freeRam / workerRam));
    if (threads <= 0) continue;

    const id = `setup-${operation}-${target}-${Date.now()}-${host}`;
    const pid = ns.exec(worker, host, threads, target, false, 0, id);
    if (pid !== 0) {
      launches.push({ host, pid });
      remaining -= threads;
    }
  }

  if (launches.length === 0) {
    ns.tprint(`ERROR: No RAM is available to run ${worker}.`);
    throw new Error(`Unable to dispatch ${operation} workers`);
  }
  ns.tprint(`Running ${requestedThreads - remaining}/${requestedThreads} ${operation} thread(s)...`);
  while (launches.some(({ host, pid }) => ns.isRunning(pid, host))) await ns.sleep(100);
}
