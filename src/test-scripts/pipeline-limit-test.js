import { batchesForTarget, readSnapshot } from './batch-tracking-helpers.js';

const DEFAULT_PIPELINE = 6;
const DEFAULT_CHAIN_SPACER = 200;

/**
 * Verify the scheduler's per-target cap, incremental refill, and landing spacing.
 * Start the scheduler first: run dynamic-hack-scheduler.js 20
 * Usage: run test-scripts/pipeline-limit-test.js [target] [port=20] [timeout=180000] [pipeline=6] [spacer=200]
 * Omit target to select the first target observed with a full pipeline.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const requestedTarget = ns.args[0] ? String(ns.args[0]) : null;
  const port = Number(ns.args[1] ?? 20);
  const timeout = Math.max(1_000, Number(ns.args[2] ?? 180_000));
  const pipeline = Math.max(1, Number(ns.args[3] ?? DEFAULT_PIPELINE));
  const spacer = Math.max(0, Number(ns.args[4] ?? DEFAULT_CHAIN_SPACER));
  const deadline = Date.now() + timeout;
  let target = requestedTarget;
  let previousIds = null;
  let observedFull = false;
  let observedRefill = false;
  let exceeded = false;
  const spacingErrors = new Set();
  let minimumSpacing = Infinity;
  let samples = 0;

  while (Date.now() < deadline && !observedRefill) {
    const snapshot = readSnapshot(ns, port);
    if (!snapshot || Date.now() - snapshot.timestamp > 1_000) {
      await ns.sleep(100);
      continue;
    }

    if (!target) {
      const counts = new Map();
      for (const batch of snapshot.batches) counts.set(batch.target, (counts.get(batch.target) ?? 0) + 1);
      target = [...counts].find(([, count]) => count === pipeline)?.[0] ?? null;
      if (!target) {
        await ns.sleep(100);
        continue;
      }
    }

    samples += 1;
    const batches = batchesForTarget(snapshot, target);
    if (batches.length > pipeline) exceeded = true;
    if (batches.length === pipeline) observedFull = true;

    const sortedBatches = batches
      .filter((batch) => Number.isFinite(batch.expectedLanding))
      .sort((a, b) => a.expectedLanding - b.expectedLanding);
    for (let i = 1; i < sortedBatches.length; i++) {
      const gap = sortedBatches[i].expectedLanding - sortedBatches[i - 1].expectedLanding;
      minimumSpacing = Math.min(minimumSpacing, gap);
      if (gap < spacer) spacingErrors.add(`${sortedBatches[i - 1].id}->${sortedBatches[i].id}:${gap}`);
    }

    const currentIds = new Set(batches.map((batch) => batch.id));
    if (observedFull && previousIds) {
      const retained = [...previousIds].some((id) => currentIds.has(id));
      const added = [...currentIds].some((id) => !previousIds.has(id));
      if (retained && added) observedRefill = true;
    }
    previousIds = currentIds;
    await ns.sleep(100);
  }

  const passed = samples > 0 && observedFull && observedRefill && !exceeded && spacingErrors.size === 0;
  ns.tprint(
    `${passed ? 'PASS' : 'FAIL'}: target=${target ?? 'none'} samples=${samples} ` +
      `full=${observedFull} incrementalRefill=${observedRefill} exceeded=${exceeded} ` +
      `minimumSpacing=${Number.isFinite(minimumSpacing) ? minimumSpacing : 'n/a'}ms ` +
      `spacingErrors=${spacingErrors.size}.`,
  );
  for (const error of spacingErrors) ns.tprint(`  spacing violation: ${error}`);
}
