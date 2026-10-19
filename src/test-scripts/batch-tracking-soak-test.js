import { batchesForTarget, readSnapshot } from './batch-tracking-helpers.js';

/**
 * Sample tracking state and verify batch counts remain bounded per target.
 * Usage: run batch-tracking-soak-test.js [seconds=300] [port=20] [limit=6]
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const seconds = Math.max(1, Number(ns.args[0] ?? 300));
  const port = Number(ns.args[1] ?? 20);
  const limit = Math.max(1, Number(ns.args[2] ?? 6));
  const deadline = Date.now() + seconds * 1000;
  const maximumByTarget = new Map();
  let maximumTotal = 0;
  let samples = 0;
  let staleSamples = 0;
  let exceeded = false;
  let refilledWhileActive = false;
  const previousIdsByTarget = new Map();

  while (Date.now() < deadline) {
    const snapshot = readSnapshot(ns, port);
    if (!snapshot) {
      await ns.sleep(250);
      continue;
    }

    samples += 1;
    if (Date.now() - snapshot.timestamp > 1_000) staleSamples += 1;
    maximumTotal = Math.max(maximumTotal, snapshot.batches.length);
    const targets = new Set(snapshot.batches.map((batch) => batch.target));
    for (const target of targets) {
      const batches = batchesForTarget(snapshot, target);
      const count = batches.length;
      maximumByTarget.set(target, Math.max(maximumByTarget.get(target) ?? 0, count));
      if (count > limit) exceeded = true;
      const currentIds = new Set(batches.map((batch) => batch.id));
      const previousIds = previousIdsByTarget.get(target);
      if (
        previousIds &&
        [...previousIds].some((id) => currentIds.has(id)) &&
        [...currentIds].some((id) => !previousIds.has(id))
      )
        refilledWhileActive = true;
      previousIdsByTarget.set(target, currentIds);
    }
    await ns.sleep(250);
  }

  ns.tprint(`Soak samples=${samples}, maxTotal=${maximumTotal}, staleSamples=${staleSamples}`);
  for (const [target, maximum] of maximumByTarget) ns.tprint(`  ${target}: max tracked batches=${maximum}`);
  const exercisedMultipleTargets = maximumByTarget.size >= 2;
  if (!exercisedMultipleTargets)
    ns.tprint('FAIL: fewer than two targets were observed; multi-target behavior was not exercised.');
  if (!refilledWhileActive)
    ns.tprint('FAIL: no target refilled an open slot while an older batch remained active.');
  const passed = samples > 0 && exercisedMultipleTargets && !exceeded && refilledWhileActive && staleSamples === 0;
  ns.tprint(
    `${passed ? 'PASS' : 'FAIL'}: per-target tracking ${exceeded ? 'exceeded' : 'stayed within'} limit ${limit}; ${
      refilledWhileActive
        ? 'open slots were refilled while prior IDs remained active'
        : 'incremental refill was not observed'
    }.`,
  );
}
