import { batchesForTarget, waitForSnapshot } from './batch-tracking-helpers.js';

/**
 * Verify that a tracked batch record disappears after all of its workers finish.
 * Usage: run batch-tracking-lifecycle-test.js [target] [port=20] [timeout=120000] [maxLag=1000]
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = ns.args[0] === undefined ? null : String(ns.args[0]);
  const port = Number(ns.args[1] ?? 20);
  const timeout = Number(ns.args[2] ?? 120_000);
  const maxLag = Number(ns.args[3] ?? 1_000);
  const first = await waitForSnapshot(ns, port, (snapshot) => batchesForTarget(snapshot, target).length > 0, timeout);
  if (!first) {
    ns.tprint('FAIL: timed out waiting for a tracked batch.');
    return;
  }

  const batch = batchesForTarget(first, target)[0];
  const removed = await waitForSnapshot(
    ns,
    port,
    (snapshot) => !snapshot.batches.some((candidate) => candidate.id === batch.id),
    timeout,
  );
  if (!removed) {
    ns.tprint(`FAIL: ${batch.id} remained tracked after the timeout.`);
    return;
  }

  const removalLag = removed.timestamp - batch.expectedLanding;
  const prompt = removalLag <= maxLag;
  ns.tprint(
    `${prompt ? 'PASS' : 'FAIL'}: ${batch.id} was removed ${removalLag}ms after its expected landing (limit ${maxLag}ms).`,
  );
}
