import { findWorkerProcesses, readSnapshot } from './batch-tracking-helpers.js';

/**
 * Verify one in-flight prep per target, snapshot/process agreement, and a clean
 * transition to batching. Put a target out of prep before running this test.
 * Usage: run test-scripts/prep-tracking-test.js [target] [port=20] [timeout=180000]
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const requestedTarget = ns.args[0] ? String(ns.args[0]) : null;
  const port = Number(ns.args[1] ?? 20);
  const deadline = Date.now() + Math.max(1_000, Number(ns.args[2] ?? 180_000));
  let target = requestedTarget;
  let sawPrep = false;
  let sawTransition = false;
  const errors = new Set();

  while (Date.now() < deadline && !sawTransition) {
    const snapshot = readSnapshot(ns, port);
    if (!snapshot || Date.now() - snapshot.timestamp > 1_000) {
      await ns.sleep(100);
      continue;
    }
    const preps = Array.isArray(snapshot.preps) ? snapshot.preps : [];
    target ??= preps[0]?.target ?? null;
    if (!target) {
      await ns.sleep(100);
      continue;
    }
    const targetPreps = preps.filter((prep) => prep.target === target);
    const targetBatches = snapshot.batches.filter((batch) => batch.target === target);
    if (targetPreps.length > 1) errors.add(`${target}: ${targetPreps.length} simultaneous prep records`);
    if (targetPreps.length > 0 && targetBatches.length > 0) {
      errors.add(`${target}: prep and batch workers overlap`);
    }
    if (targetPreps.length > 0) {
      sawPrep = true;
      const live = findWorkerProcesses(ns).filter((process) => String(process.args[3]) === targetPreps[0].id);
      if (live.length !== targetPreps[0].operations.length && targetPreps[0].expectedLanding > Date.now() + 200) {
        errors.add(
          `${targetPreps[0].id}: snapshot has ${targetPreps[0].operations.length}, process table has ${live.length}`,
        );
      }
    }
    if (sawPrep && targetPreps.length === 0 && targetBatches.length > 0) sawTransition = true;
    await ns.sleep(100);
  }

  const passed = sawPrep && sawTransition && errors.size === 0;
  ns.tprint(
    `${passed ? 'PASS' : 'FAIL'}: target=${target ?? 'none'} sawPrep=${sawPrep} transitioned=${sawTransition} errors=${
      errors.size
    }.`,
  );
  for (const error of errors) ns.tprint(`  ${error}`);
}
