const STEP_PAD = 120;
const STARTUP_BUFFER = 2_000;
const POLL_INTERVAL = 5;

/**
 * Launches one HWGW batch on the current host and reports its landing order.
 *
 * Usage: run batch-order-test.js [target=joesguns] [stealFraction=0.01]
 *
 * @param {NS} ns - The Netscript environment.
 */
export async function main(ns) {
  const host = ns.getHostname();
  const target = String(ns.args[0] ?? 'joesguns');
  const stealFraction = Number(ns.args[1] ?? 0.01);

  if (!ns.serverExists(target) || !ns.hasRootAccess(target)) {
    ns.tprint(`ERROR: ${target} must exist and have root access.`);
    return;
  }
  if (!(stealFraction > 0 && stealFraction < 1)) {
    ns.tprint('ERROR: stealFraction must be greater than 0 and less than 1.');
    return;
  }

  const batch = calculateBatch(ns, target, stealFraction);
  const jobs = [
    { label: 'hack', file: 'hack.js', threads: batch.hackThreads, offset: -3 * STEP_PAD },
    { label: 'weaken-hack', file: 'weaken.js', threads: batch.hackWeakenThreads, offset: -2 * STEP_PAD },
    { label: 'grow', file: 'grow.js', threads: batch.growThreads, offset: -STEP_PAD },
    { label: 'weaken-grow', file: 'weaken.js', threads: batch.growWeakenThreads, offset: 0 },
  ];

  for (const job of jobs) {
    if (!ns.fileExists(job.file, host)) {
      ns.tprint(`ERROR: ${job.file} is not present on ${host}.`);
      return;
    }
  }

  const requiredRam = jobs.reduce(
    (total, job) => total + ns.getScriptRam(job.file, host) * job.threads,
    0,
  );
  const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
  if (requiredRam > freeRam) {
    ns.tprint(
      `ERROR: Batch needs ${ns.formatRam(requiredRam)}, but ${host} has ${ns.formatRam(
        freeRam,
      )} free. Try a smaller steal fraction or a larger host.`,
    );
    return;
  }

  const actionTimes = {
    hack: ns.getHackTime(target),
    grow: ns.getGrowTime(target),
    weaken: ns.getWeakenTime(target),
  };
  const finalLanding = Date.now() + Math.max(...Object.values(actionTimes)) + STARTUP_BUFFER;
  const batchId = `batch-order-test-${Date.now()}`;
  const running = [];

  for (const job of jobs) {
    const action = job.label === 'hack' ? 'hack' : job.label === 'grow' ? 'grow' : 'weaken';
    const landingTime = finalLanding + job.offset;
    const delay = Math.max(0, Math.floor(landingTime - actionTimes[action] - Date.now()));
    const operationId = `${batchId}-${job.label}`;
    const pid = ns.exec(job.file, host, job.threads, target, false, delay, operationId);

    if (pid === 0) {
      for (const launched of running) ns.kill(launched.pid);
      ns.tprint(`ERROR: Failed to launch ${job.label}; killed the partial batch.`);
      return;
    }

    running.push({ ...job, pid, expectedLanding: landingTime });
  }

  ns.tprint(`Running one batch against ${target}; expected: hack -> weaken-hack -> grow -> weaken-grow`);

  const completionOrder = [];
  while (completionOrder.length < running.length) {
    for (const job of running) {
      if (!completionOrder.includes(job) && !ns.isRunning(job.pid, host)) {
        completionOrder.push(job);
        const timingError = Date.now() - job.expectedLanding;
        ns.tprint(`${job.label} landed (${formatSigned(timingError)} ms from expected)`);
      }
    }
    if (completionOrder.length < running.length) await ns.sleep(POLL_INTERVAL);
  }

  const actual = completionOrder.map((job) => job.label);
  const expected = jobs.map((job) => job.label);
  const passed = actual.every((label, index) => label === expected[index]);
  ns.tprint(`${passed ? 'PASS' : 'FAIL'}: actual order was ${actual.join(' -> ')}`);
}

function calculateBatch(ns, target, stealFraction) {
  const server = ns.getServer(target);
  const currentMoney = Math.max(1, server.moneyAvailable ?? 0);
  const maximumMoney = Math.max(1, server.moneyMax ?? 0);
  const stealAmount = Math.max(1, Math.floor(currentMoney * stealFraction));
  const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, stealAmount)));
  const moneyAfterHack = Math.max(1, currentMoney * (1 - ns.hackAnalyze(target) * hackThreads));
  const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, maximumMoney / moneyAfterHack)));

  return {
    hackThreads,
    growThreads,
    hackWeakenThreads: Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05)),
    growWeakenThreads: Math.max(1, Math.ceil((growThreads * 0.004) / 0.05)),
  };
}

function formatSigned(value) {
  return `${value >= 0 ? '+' : ''}${value}`;
}