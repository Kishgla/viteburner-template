const WORKERS = [
  { file: 'hack.js', expected: 'money down, security up' },
  { file: 'grow.js', expected: 'money up, security up' },
  { file: 'weaken.js', expected: 'security down' },
];

/**
 * Runs each hacking worker sequentially and reports the target state before and
 * after every operation.
 *
 * Usage: run worker-test.js [target=joesguns] [threads=10]
 *
 * @param {NS} ns - The Netscript environment.
 */
export async function main(ns) {
  const target = String(ns.args[0] ?? 'joesguns');
  const threads = Math.floor(Number(ns.args[1] ?? 10));
  const host = ns.getHostname();

  if (!ns.serverExists(target)) {
    ns.tprint(`ERROR: Target ${target} does not exist.`);
    return;
  }
  if (!ns.hasRootAccess(target)) {
    ns.tprint(`ERROR: Root access to ${target} is required.`);
    return;
  }
  if (!Number.isFinite(threads) || threads < 1) {
    ns.tprint('ERROR: Threads must be a positive integer.');
    return;
  }

  for (const worker of WORKERS) {
    if (!ns.fileExists(worker.file, host)) {
      ns.tprint(`ERROR: ${worker.file} does not exist on ${host}.`);
      return;
    }
  }

  ns.tprint(`Worker test: ${target}, ${threads} threads per operation`);
  printState(ns, target, 'Initial');

  for (let index = 0; index < WORKERS.length; index++) {
    const worker = WORKERS[index];
    const requiredRam = ns.getScriptRam(worker.file, host) * threads;
    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

    if (requiredRam > freeRam) {
      ns.tprint(
        `ERROR: ${worker.file} needs ${ns.formatRam(requiredRam)}, but only ${ns.formatRam(freeRam)} is free on ${host}.`,
      );
      return;
    }

    const before = getState(ns, target);
    const testId = `worker-test-${Date.now()}-${index}`;
    const pid = ns.exec(worker.file, host, threads, target, false, 0, testId);

    if (pid === 0) {
      ns.tprint(`ERROR: Failed to launch ${worker.file} on ${host}.`);
      return;
    }

    ns.tprint(`Running ${worker.file}; expected: ${worker.expected}...`);
    while (ns.isRunning(pid, host)) {
      await ns.sleep(100);
    }

    printState(ns, target, `After ${worker.file}`, before);
  }

  ns.tprint('Worker test complete.');
}

function getState(ns, target) {
  return {
    money: ns.getServerMoneyAvailable(target),
    maxMoney: ns.getServerMaxMoney(target),
    security: ns.getServerSecurityLevel(target),
    minSecurity: ns.getServerMinSecurityLevel(target),
  };
}

function printState(ns, target, label, previous = null) {
  const state = getState(ns, target);
  const moneyDelta = previous ? state.money - previous.money : 0;
  const securityDelta = previous ? state.security - previous.security : 0;
  const deltas = previous
    ? ` | delta: money ${formatSigned(ns, moneyDelta)}, security ${formatSigned(ns, securityDelta, 3)}`
    : '';

  ns.tprint(
    `${label} ${target} | money ${ns.formatNumber(state.money, 2)}/${ns.formatNumber(state.maxMoney, 2)} | security ${state.security.toFixed(3)}/${state.minSecurity.toFixed(3)}${deltas}`,
  );
}

function formatSigned(ns, value, decimals = 2) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${ns.formatNumber(value, decimals)}`;
}