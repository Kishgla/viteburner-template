import { batchesForTarget, waitForSnapshot } from './batch-tracking-helpers.js';

/**
 * Kill one tracked worker and verify its stale PID is removed from the snapshot.
 * Usage: run batch-tracking-repair-test.js [target] [port=20] [timeout=60000]
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = ns.args[0] === undefined ? null : String(ns.args[0]);
  const port = Number(ns.args[1] ?? 20);
  const timeout = Number(ns.args[2] ?? 60_000);
  const first = await waitForSnapshot(
    ns,
    port,
    (snapshot) => batchesForTarget(snapshot, target).some(
      (batch) => batch.operations.length > 1 && batch.expectedLanding > Date.now() + 1_000,
    ),
    timeout,
  );
  if (!first) {
    ns.tprint('FAIL: timed out waiting for a tracked worker.');
    return;
  }

  const batch = batchesForTarget(first, target).find(
    (candidate) => candidate.operations.length > 1 && candidate.expectedLanding > Date.now() + 1_000,
  );
  const victim = batch.operations[0];
  const siblingKeys = new Set(
    batch.operations.slice(1).map((operation) => `${operation.host}:${operation.pid}`),
  );
  if (!ns.kill(victim.pid, victim.host)) {
    ns.tprint(`FAIL: could not kill pid=${victim.pid} on ${victim.host}.`);
    return;
  }

  const repaired = await waitForSnapshot(
    ns,
    port,
    (snapshot) => {
      const current = snapshot.batches.find((candidate) => candidate.id === batch.id);
      if (!current) return false;
      const victimGone = !current.operations.some(
        (operation) => operation.pid === victim.pid && operation.host === victim.host,
      );
      const siblingRemains = current.operations.some(
        (operation) => siblingKeys.has(`${operation.host}:${operation.pid}`),
      );
      return victimGone && siblingRemains;
    },
    timeout,
  );
  ns.tprint(
    `${repaired ? 'PASS' : 'FAIL'}: killed pid=${victim.pid}@${victim.host} was ${repaired ? 'removed while live siblings remained tracked' : 'not reconciled before its batch ended'}.`,
  );
}
