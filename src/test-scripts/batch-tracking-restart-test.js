import {
  SCHEDULER,
  findWorkerProcesses,
  processKey,
  scanNetwork,
  trackedJobs,
  waitForSnapshot,
} from './batch-tracking-helpers.js';

/**
 * Restart the scheduler while batch workers are active and verify they are recovered.
 * The scheduler is relaunched on the same host with its original arguments.
 * Usage: run batch-tracking-restart-test.js [port=20] [timeout=60000]
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const timeout = Number(ns.args[1] ?? 60_000);
  const before = await waitForSnapshot(
    ns,
    port,
    (snapshot) => snapshot.batches.some(
      (batch) => batch.operations.length > 0 && batch.expectedLanding > Date.now() + 1_000,
    ),
    timeout,
  );
  if (!before) {
    ns.tprint('FAIL: timed out waiting for active tracked workers.');
    return;
  }

  let scheduler = null;
  for (const host of scanNetwork(ns)) {
    const match = ns.ps(host).find((process) => process.filename === SCHEDULER && process.pid === before.schedulerPid);
    if (match) {
      scheduler = { host, ...match };
      break;
    }
  }
  if (!scheduler) {
    ns.tprint(`FAIL: could not find scheduler pid=${before.schedulerPid}.`);
    return;
  }

  const liveKeys = new Set(findWorkerProcesses(ns).map((process) => processKey(process.host, process.pid)));
  const expectedIds = new Set(
    trackedJobs(before)
      .filter((job) => liveKeys.has(processKey(job.host, job.pid)))
      .map((job) => job.batchId),
  );
  if (expectedIds.size === 0) {
    ns.tprint('FAIL: the snapshot had no workers that were still live.');
    return;
  }

  if (!ns.kill(scheduler.pid, scheduler.host)) {
    ns.tprint(`FAIL: could not stop scheduler pid=${scheduler.pid}.`);
    return;
  }
  ns.clearPort(port);
  const replacementPid = ns.exec(SCHEDULER, scheduler.host, scheduler.threads, ...scheduler.args);
  if (replacementPid === 0) {
    ns.tprint(`FAIL: scheduler stopped but could not be relaunched on ${scheduler.host}.`);
    return;
  }

  const recovered = await waitForSnapshot(
    ns,
    port,
    (snapshot) => snapshot.schedulerPid === replacementPid
      && snapshot.batches.some((batch) => expectedIds.has(batch.id) && batch.recovered),
    timeout,
  );
  const recoveredTargets = new Set(
    (recovered?.batches ?? [])
      .filter((batch) => expectedIds.has(batch.id) && batch.recovered)
      .map((batch) => batch.target),
  );
  const prematureNewWork = (recovered?.batches ?? []).some(
    (batch) => recoveredTargets.has(batch.target) && !expectedIds.has(batch.id),
  );
  const passed = recovered !== null && !prematureNewWork;
  ns.tprint(
    `${passed ? 'PASS' : 'FAIL'}: scheduler pid=${replacementPid} ${recovered ? 'recovered existing work' : 'did not report recovery before timeout'}${prematureNewWork ? ' but also dispatched new work for a recovering target' : ''}.`,
  );
}
