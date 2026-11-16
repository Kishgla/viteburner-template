import { findWorkerProcesses, readSnapshot } from './batch-tracking-helpers.js';

const PHASES = new Set(['hack', 'weaken-hack', 'grow', 'weaken-grow']);
const EARLIEST_PHASE_OFFSET = 3 * 120;
const LIVE_SCAN_MARGIN = 1_000;

/**
 * Validate scheduler batch allocations and confirm RAM rejections launch nothing.
 * Start the scheduler first: run dynamic-hack-scheduler.js 20
 * Usage: run test-scripts/atomic-dispatch-test.js [port=20] [timeout=120000] [mode=complete]
 *
 * Use mode `rejection` in a constrained-RAM run to require an insufficient-RAM
 * rejection. Mode `rollback` validates the scheduler's test-only injected exec
 * failure (`--test-fail-exec-after=1`). The default validates a complete dispatch.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const timeout = Math.max(1_000, Number(ns.args[1] ?? 120_000));
  const mode = String(ns.args[2] ?? 'complete').toLowerCase();
  const requireRejection = mode === 'rejection';
  const requireRollback = mode === 'rollback';
  const startedAt = Date.now();
  const deadline = Date.now() + timeout;
  let checkedComplete = false;
  let checkedRejected = false;
  let checkedRollback = false;
  let snapshots = 0;
  let observedBatches = 0;
  let legacyBatches = 0;
  let observedAttempts = 0;
  const errors = new Set();

  while (
    Date.now() < deadline &&
    !(requireRejection ? checkedRejected : requireRollback ? checkedRollback : checkedComplete)
  ) {
    const snapshot = readSnapshot(ns, port);
    if (!snapshot || Date.now() - snapshot.timestamp > 1_000) {
      await ns.sleep(100);
      continue;
    }

    snapshots += 1;
    observedBatches = Math.max(observedBatches, snapshot.batches.length);
    observedAttempts = Math.max(observedAttempts, (snapshot.dispatchAttempts ?? []).length);
    for (const batch of snapshot.batches) {
      if (batch.dispatchStatus === undefined) legacyBatches += 1;
      if (requireRejection) continue;
      if (batch.dispatchStatus !== 'complete' || !Array.isArray(batch.threadAllocation)) continue;
      // A batch remains tracked after its earlier phases finish. Only compare its
      // PIDs with ns.ps while even the earliest (hack) landing is safely ahead.
      const earliestLanding = batch.expectedLanding - EARLIEST_PHASE_OFFSET;
      if (earliestLanding <= Date.now() + LIVE_SCAN_MARGIN) continue;

      const processes = findWorkerProcesses(ns);
      const phases = new Set(batch.threadAllocation.map((allocation) => allocation.phase));
      for (const phase of PHASES) {
        if (!phases.has(phase)) errors.add(`${batch.id}: missing allocation for ${phase}`);
      }

      for (const allocation of batch.threadAllocation) {
        const planned = allocation.workers.reduce((total, worker) => total + worker.threads, 0);
        if (planned !== allocation.threads) {
          errors.add(`${batch.id}/${allocation.phase}: planned ${planned}/${allocation.threads} threads`);
        }
      }
      for (const operation of batch.operations) {
        const live = processes.some(
          (process) =>
            process.host === operation.host &&
            process.pid === operation.pid &&
            process.threads === operation.threads &&
            String(process.args[3]) === batch.id,
        );
        if (!live) errors.add(`${batch.id}: tracked operation ${operation.host}:${operation.pid} is not live`);
      }
      checkedComplete = true;
      break;
    }

    for (const attempt of requireRejection || requireRollback ? snapshot.dispatchAttempts ?? [] : []) {
      if (attempt.timestamp < startedAt) continue;
      if (requireRejection && (attempt.status !== 'failed' || attempt.reason !== 'insufficient-ram')) continue;
      if (requireRollback && (attempt.status !== 'failed' || attempt.reason !== 'launch-failed')) continue;
      const processes = findWorkerProcesses(ns);
      if (requireRejection) checkedRejected = true;
      if (requireRollback) checkedRollback = true;
      if (processes.some((process) => String(process.args[3]) === attempt.id)) {
        errors.add(`${attempt.id}: rejected dispatch left a worker running`);
      }
    }
    await ns.sleep(100);
  }

  const requiredCheck = requireRejection ? checkedRejected : requireRollback ? checkedRollback : checkedComplete;
  const passed = requiredCheck && errors.size === 0;
  ns.tprint(
    `${passed ? 'PASS' : 'FAIL'}: mode=${mode} completeDispatch=${checkedComplete} ` +
      `ramRejection=${checkedRejected} rollback=${checkedRollback} errors=${errors.size}.`,
  );
  if (!requiredCheck) {
    ns.tprint(
      `  Observed snapshots=${snapshots}, maxBatches=${observedBatches}, ` +
        `maxAttempts=${observedAttempts}, legacyBatchSamples=${legacyBatches}.`,
    );
  }
  if (!checkedComplete && legacyBatches > 0) {
    ns.tprint('  Batches lack Step 5 fields. Restart dynamic-hack-scheduler.js so it loads the updated code.');
  } else if (!checkedComplete && !requireRejection && !requireRollback) {
    ns.tprint('  No new complete batch was observed; wait for recovered batches to drain or restart without workers.');
  }
  if (requireRejection && !checkedRejected) {
    ns.tprint('  No insufficient-RAM attempt observed; reduce available worker RAM and rerun rejection mode.');
  }
  if (requireRollback && !checkedRollback) {
    ns.tprint('  No rollback observed; start the scheduler with --test-fail-exec-after=1 on a prepared target.');
  }
  const displayedErrors = [...errors].slice(0, 20);
  for (const error of displayedErrors) ns.tprint(`  ${error}`);
  if (errors.size > displayedErrors.length) {
    ns.tprint(`  ... ${errors.size - displayedErrors.length} additional errors omitted.`);
  }
}
