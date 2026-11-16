import { readSnapshot } from './batch-tracking-helpers.js';

/** Validate the scheduler's machine-readable operational status snapshot.
 * Usage: run test-scripts/scheduler-status-test.js [port=20] [timeout=60000]
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const deadline = Date.now() + Math.max(1_000, Number(ns.args[1] ?? 60_000));
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = readSnapshot(ns, port);
    if (snapshot && Array.isArray(snapshot.preps) && Array.isArray(snapshot.targets)) break;
    await ns.sleep(100);
  }
  const errors = [];
  if (!snapshot) errors.push('no current scheduler snapshot');
  if (snapshot && !Number.isInteger(snapshot.schedulerPid)) errors.push('missing scheduler PID');
  if (snapshot && !Number.isInteger(snapshot.schedulerVersion)) errors.push('missing scheduler version');
  if (snapshot && !Array.isArray(snapshot.dispatchAttempts)) errors.push('missing dispatch attempts');
  for (const status of snapshot?.targets ?? []) {
    if (typeof status.target !== 'string' || typeof status.state !== 'string') errors.push('invalid target status');
    if (!Number.isInteger(status.pipeline) || status.pipeline < 0)
      errors.push(`${status.target}: invalid pipeline depth`);
  }
  for (const batch of snapshot?.batches ?? []) {
    if (!Array.isArray(batch.threadAllocation) && !batch.recovered) errors.push(`${batch.id}: missing allocations`);
  }
  ns.tprint(
    `${errors.length === 0 ? 'PASS' : 'FAIL'}: targets=${snapshot?.targets?.length ?? 0} batches=${
      snapshot?.batches?.length ?? 0
    } preps=${snapshot?.preps?.length ?? 0}.`,
  );
  for (const error of errors) ns.tprint(`  ${error}`);
}
