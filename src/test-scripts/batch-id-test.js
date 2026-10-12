import { batchesForTarget, findWorkerProcesses, processKey, readSnapshot } from './batch-tracking-helpers.js';

const ID_PATTERN = /^batch-[a-zA-Z0-9_-]+-[0-9a-z]+-\d+-\d+$/;

function operationCounts(batch) {
  const counts = { hack: 0, grow: 0, weaken: 0 };
  for (const job of batch.operations) counts[job.operation] = (counts[job.operation] ?? 0) + 1;
  return counts;
}

function isCompleteBatch(batch) {
  const counts = operationCounts(batch);
  return counts.hack >= 1 && counts.grow >= 1 && counts.weaken >= 2;
}

async function waitForLiveCompleteBatches(ns, port, target, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = readSnapshot(ns, port);
    if (snapshot && Date.now() - snapshot.timestamp <= 1_000) {
      const liveByPid = new Map(
        findWorkerProcesses(ns).map((process) => [processKey(process.host, process.pid), process]),
      );
      const batches = batchesForTarget(snapshot, target)
        .filter(isCompleteBatch)
        .filter((batch) => batch.operations.every((job) => liveByPid.has(processKey(job.host, job.pid))));
      if (batches.length >= 2) return { batches, liveByPid };
    }
    await ns.sleep(100);
  }
  return null;
}

/**
 * Validate IDs created by the running scheduler rather than constructing test IDs.
 * Start it first with: run dynamic-hack-scheduler.js 20
 * Usage: run test-scripts/batch-id-test.js [port=20] [target|*] [requireSplit=false] [timeout=60000]
 * Use * for all targets when setting later arguments, for example:
 * run test-scripts/batch-id-test.js 20 * true
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const targetArg = ns.args[1] === undefined ? null : String(ns.args[1]);
  const target = targetArg === null || targetArg === '*' ? null : targetArg;
  const requireSplit = ns.args[2] === true || String(ns.args[2]).toLowerCase() === 'true';
  const timeout = Math.max(1_000, Number(ns.args[3] ?? 60_000));
  const sample = await waitForLiveCompleteBatches(ns, port, target, timeout);
  if (!sample) {
    ns.tprint(`FAIL: no coherent sample containing two complete batches${target ? ` for ${target}` : ''} on port ${port}.`);
    return;
  }

  // Reconciliation retains only live processes. During normal staggered landing,
  // older batches therefore contain WGW, then GW, then W before disappearing.
  // Those lifecycle states, and processes that end while the network is scanned,
  // are outside this ID test.
  const { batches, liveByPid } = sample;
  const errors = [];
  const ids = new Set();
  const signaturesByHost = new Map();
  const splitBatches = new Map();

  for (const batch of batches) {
    if (!ID_PATTERN.test(batch.id)) errors.push(`${batch.id}: invalid normal-batch ID format`);
    if (ids.has(batch.id)) errors.push(`${batch.id}: duplicate batch ID`);
    ids.add(batch.id);
    const portions = new Map();

    for (const job of batch.operations) {
      const process = liveByPid.get(processKey(job.host, job.pid));
      if (!process) {
        errors.push(`${batch.id}: missing ${job.file}@${job.host} pid=${job.pid}`);
        continue;
      }
      const args = process.args;
      if (args.length !== 4 || String(args[0]) !== batch.target || String(args[3]) !== batch.id) {
        errors.push(`${batch.id}: unexpected args for pid=${job.pid}: ${JSON.stringify(args)}`);
      }
      // dispatchToEnd recalculates Date.now() for each host, so portions of one
      // logical operation may differ by a few milliseconds. A 20ms delay bucket
      // keeps split portions together without combining the two weaken stages.
      const signature = `${process.filename}|${args[0]}|${args[1]}|${Math.round(Number(args[2]) / 20)}|${args[3]}`;
      const hosts = portions.get(signature) ?? new Set();
      hosts.add(job.host);
      portions.set(signature, hosts);
      const hostSignature = `${job.host}|${process.filename}|${args[0]}|${args[1]}`;
      const hostIds = signaturesByHost.get(hostSignature) ?? new Set();
      hostIds.add(batch.id);
      signaturesByHost.set(hostSignature, hostIds);
    }

    for (const [signature, hosts] of portions) {
      if (hosts.size > 1 && !splitBatches.has(batch.id)) {
        splitBatches.set(batch.id, { signature, hosts: [...hosts] });
      }
    }
  }

  const coexist = [...signaturesByHost.values()].some((batchIds) => batchIds.size > 1);
  if (!coexist) errors.push('no otherwise-identical operations with different IDs coexist on one host');
  if (requireSplit && splitBatches.size === 0) errors.push('no operation was split across multiple hosts');
  const reportedBatches = requireSplit
    ? batches.filter((batch) => splitBatches.has(batch.id))
    : batches;
  for (const batch of reportedBatches) {
    ns.tprint(`  ${batch.id} target=${batch.target} portions=${batch.operations.length}`);
    const split = splitBatches.get(batch.id);
    if (split) ns.tprint(`    Split across ${split.hosts.join(', ')}`);
  }
  for (const error of errors) ns.tprint(`  ERROR: ${error}`);
  ns.tprint(`${errors.length === 0 ? 'PASS' : 'FAIL'}: checked ${batches.length} scheduler-created batches and ${ids.size} unique IDs.`);
}
