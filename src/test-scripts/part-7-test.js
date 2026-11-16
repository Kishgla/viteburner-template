import { findWorkerProcesses, readSnapshot, scanNetwork, SCHEDULER } from './batch-tracking-helpers.js';

const PREP_SETUP = 'utility-scripts/prep-state-setup.js';
const RAM_PRESSURE = 'utility-scripts/atomic-dispatch-ram-pressure.js';

/**
 * Run the operational-visibility and lifecycle checks from TODO Part 7.
 * This test temporarily restarts the scheduler, changes one target's state,
 * and applies RAM pressure. It always restores a normal scheduler afterward.
 *
 * Usage: run test-scripts/part-7-test.js [target] [port=20] [timeout=180000]
 * Omit target to use the first viable target in the scheduler snapshot.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const requestedTarget = ns.args[0] === undefined ? null : String(ns.args[0]);
  const port = Number(ns.args[1] ?? 20);
  const timeout = Math.max(30_000, Number(ns.args[2] ?? 180_000));
  const results = [];
  let pressurePid = 0;

  if (ns.getHostname() !== 'home') {
    ns.tprint('FAIL: run this test from home.');
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 20) {
    ns.tprint(`FAIL: invalid tracking port ${port}.`);
    return;
  }

  try {
    phase(ns, 'Starting a normal scheduler and validating its status snapshot...');
    stopSchedulers(ns);
    startScheduler(ns, port);
    let snapshot = await waitForFreshSnapshot(ns, port, () => true, timeout);
    check(results, 'status snapshot', validateStatusSnapshot(ns, snapshot));
    if (!snapshot) throw new Error('No fresh scheduler snapshot was published.');

    const originalOwner = snapshot.schedulerPid;
    phase(ns, 'Checking that a second launch does not create another owner...');
    ns.run(SCHEDULER, 1, port);
    await ns.sleep(1_000);
    snapshot = readFreshSnapshot(ns, port);
    check(results, 'singleton launch', snapshot?.schedulerPid === originalOwner && findSchedulers(ns).length === 1);

    const target = chooseTarget(ns, snapshot, requestedTarget);
    if (!target) throw new Error('No rooted, hackable money target is available.');
    ns.tprint(`Using ${target} for prep, recovery, and rollback checks.`);

    phase(ns, 'Waiting for active workers on the setup target to finish...');
    stopSchedulers(ns);
    const drained = await waitUntil(ns, () => workersForTarget(ns, target).length === 0, timeout);
    check(results, 'clean target setup', drained);
    if (!drained) throw new Error(`${target} still has active workers after the timeout.`);

    phase(ns, 'Creating a grow-prep state...');
    const setupPid = ns.run(PREP_SETUP, 1, target, 'grow');
    if (setupPid === 0) throw new Error(`Could not start ${PREP_SETUP}.`);
    const setupFinished = await waitUntil(ns, () => !ns.isRunning(setupPid, 'home'), timeout);
    const server = ns.getServer(target);
    const setupReady =
      setupFinished &&
      server.moneyAvailable < server.moneyMax * 0.95 &&
      server.hackDifficulty <= server.minDifficulty + 5;
    check(results, 'prep-state setup', setupReady);
    if (!setupReady) throw new Error(`Could not put ${target} into the expected grow-prep state.`);

    phase(ns, 'Observing prep tracking, then restarting during prep to test recovery...');
    startScheduler(ns, port);
    const prepSnapshot = await waitForFreshSnapshot(
      ns,
      port,
      (value) => {
        const prep = value.preps?.find((candidate) => candidate.target === target);
        if (!prep || prep.expectedLanding <= Date.now() + 500) return false;
        const live = findWorkerProcesses(ns).filter((process) => String(process.args[3]) === prep.id);
        return live.length === prep.operations.length && live.length > 0;
      },
      timeout,
    );
    check(results, 'prep status', prepSnapshot !== null);
    if (!prepSnapshot) throw new Error(`No tracked prep appeared for ${target}.`);

    const prepId = prepSnapshot.preps.find((prep) => prep.target === target)?.id;
    stopSchedulers(ns);
    // Bypass the public launcher's delayed bootstrap here. This phase must put
    // the replacement owner in place while the deliberately observed prep is
    // still live, so launch the same tagged version reconstructed above.
    startScheduler(ns, port, `--scheduler-version=${prepSnapshot.schedulerVersion}`);
    const recoverySnapshot = await waitForFreshSnapshot(
      ns,
      port,
      (value) =>
        value.targets?.some((status) => status.target === target && status.state === 'recovering') &&
        value.preps?.some((prep) => prep.id === prepId),
      timeout,
    );
    check(results, 'prep recovery without duplicate ownership', recoverySnapshot !== null);

    const batchingSnapshot = await waitForFreshSnapshot(
      ns,
      port,
      (value) => value.targets?.some((status) => status.target === target && status.state === 'batching'),
      timeout,
    );
    check(results, 'prep-to-batching transition', batchingSnapshot !== null);

    phase(ns, 'Applying RAM pressure and waiting for an atomic rejection...');
    const rejectionStartedAt = Date.now();
    pressurePid = ns.run(RAM_PRESSURE, 1, timeout, 16);
    if (pressurePid === 0) throw new Error(`Could not start ${RAM_PRESSURE}.`);
    const rejectionSnapshot = await waitForFreshSnapshot(
      ns,
      port,
      (value) =>
        value.dispatchAttempts?.some(
          (attempt) =>
            attempt.timestamp >= rejectionStartedAt &&
            attempt.status === 'failed' &&
            attempt.reason === 'insufficient-ram',
        ),
      timeout,
    );
    const rejection = rejectionSnapshot?.dispatchAttempts
      ?.filter((attempt) => attempt.timestamp >= rejectionStartedAt)
      .find((attempt) => attempt.status === 'failed' && attempt.reason === 'insufficient-ram');
    check(
      results,
      'RAM rejection and retained failure status',
      rejection !== undefined && !findWorkerProcesses(ns).some((process) => String(process.args[3]) === rejection.id),
    );
    if (pressurePid !== 0) ns.kill(pressurePid, 'home');
    pressurePid = 0;
    await ns.sleep(500);

    phase(ns, 'Injecting a launch failure and verifying rollback...');
    stopSchedulers(ns);
    const rollbackStartedAt = Date.now();
    startScheduler(ns, port, '--test-fail-exec-after=1');
    const rollbackSnapshot = await waitForFreshSnapshot(
      ns,
      port,
      (value) =>
        value.dispatchAttempts?.some(
          (attempt) =>
            attempt.timestamp >= rollbackStartedAt && attempt.status === 'failed' && attempt.reason === 'launch-failed',
        ),
      timeout,
    );
    const rollback = rollbackSnapshot?.dispatchAttempts
      ?.filter((attempt) => attempt.timestamp >= rollbackStartedAt)
      .find((attempt) => attempt.status === 'failed' && attempt.reason === 'launch-failed');
    check(
      results,
      'failed-launch rollback',
      rollback !== undefined && !findWorkerProcesses(ns).some((process) => String(process.args[3]) === rollback.id),
    );

    phase(ns, 'Removing the fault flag and restoring a normal scheduler...');
    stopSchedulers(ns);
    startScheduler(ns, port);
    const restored = await waitForFreshSnapshot(ns, port, () => true, timeout);
    check(
      results,
      'normal owner restored',
      restored !== null &&
        findSchedulers(ns).length === 1 &&
        !findSchedulers(ns)[0].args.some((arg) => String(arg).startsWith('--test-fail-exec-after=')),
    );
  } catch (error) {
    ns.tprint(`ERROR: ${String(error)}`);
    results.push({ name: 'test sequence completed', passed: false });
  } finally {
    if (pressurePid !== 0) ns.kill(pressurePid, 'home');
    stopSchedulers(ns);
    startScheduler(ns, port);
  }

  ns.tprint('Part 7 test summary:');
  for (const result of results) ns.tprint(`  ${result.passed ? 'PASS' : 'FAIL'}: ${result.name}`);
  const failures = results.filter((result) => !result.passed).length;
  ns.tprint(`${failures === 0 ? 'PASS' : 'FAIL'}: Part 7 checks completed with ${failures} failure(s).`);
}

function phase(ns, message) {
  ns.tprint(`\n--- ${message}`);
}

function check(results, name, passed) {
  results.push({ name, passed: Boolean(passed) });
}

function findSchedulers(ns) {
  return scanNetwork(ns).flatMap((host) =>
    ns
      .ps(host)
      .filter((process) => process.filename === SCHEDULER)
      .map((process) => ({ host, ...process })),
  );
}

function stopSchedulers(ns) {
  for (const process of findSchedulers(ns)) ns.kill(process.pid, process.host);
}

function startScheduler(ns, port, ...args) {
  const pid = ns.run(SCHEDULER, 1, port, ...args);
  if (pid === 0) throw new Error(`Could not start ${SCHEDULER}.`);
  return pid;
}

function readFreshSnapshot(ns, port) {
  const snapshot = readSnapshot(ns, port);
  const ownerIsLive = snapshot && findSchedulers(ns).some((process) => process.pid === snapshot.schedulerPid);
  return snapshot && ownerIsLive && Date.now() - snapshot.timestamp <= 1_000 ? snapshot : null;
}

async function waitForFreshSnapshot(ns, port, predicate, timeout) {
  return waitForValue(
    ns,
    () => {
      const snapshot = readFreshSnapshot(ns, port);
      return snapshot && predicate(snapshot) ? snapshot : null;
    },
    timeout,
  );
}

async function waitForValue(ns, read, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await ns.sleep(100);
  }
  return null;
}

async function waitUntil(ns, predicate, timeout) {
  return (await waitForValue(ns, () => (predicate() ? true : null), timeout)) === true;
}

function workersForTarget(ns, target) {
  return findWorkerProcesses(ns).filter((process) => String(process.args[0]) === target);
}

function chooseTarget(ns, snapshot, requestedTarget) {
  if (requestedTarget !== null) {
    if (
      ns.serverExists(requestedTarget) &&
      ns.hasRootAccess(requestedTarget) &&
      ns.getServerMaxMoney(requestedTarget) > 0 &&
      ns.getServerRequiredHackingLevel(requestedTarget) <= ns.getHackingLevel()
    )
      return requestedTarget;
    return null;
  }
  return (
    snapshot?.targets
      ?.map((status) => status.target)
      .find(
        (target) =>
          ns.serverExists(target) &&
          ns.hasRootAccess(target) &&
          ns.getServerMaxMoney(target) > 0 &&
          ns.getServerRequiredHackingLevel(target) <= ns.getHackingLevel(),
      ) ?? null
  );
}

function validateStatusSnapshot(ns, snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.schedulerPid) || !Number.isInteger(snapshot.schedulerVersion))
    return false;
  if (!Array.isArray(snapshot.targets) || !Array.isArray(snapshot.preps)) return false;
  if (!Array.isArray(snapshot.batches) || !Array.isArray(snapshot.dispatchAttempts)) return false;
  if (!findSchedulers(ns).some((process) => process.pid === snapshot.schedulerPid)) return false;
  if (
    snapshot.targets.some(
      (status) =>
        typeof status.target !== 'string' ||
        typeof status.state !== 'string' ||
        !Number.isInteger(status.pipeline) ||
        status.pipeline < 0,
    )
  )
    return false;
  return snapshot.batches.every((batch) => Array.isArray(batch.threadAllocation) || batch.recovered);
}
