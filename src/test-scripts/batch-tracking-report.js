import {
  batchesForTarget,
  findWorkerProcesses,
  processKey,
  readSnapshot,
  trackedJobs,
} from './batch-tracking-helpers.js';

/**
 * Compare the scheduler's tracked PIDs with live worker processes.
 * Start the scheduler with a snapshot port first: run dynamic-hack-scheduler.js 20
 * Usage: run batch-tracking-report.js [port=20] [target]
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const target = ns.args[1] === undefined ? null : String(ns.args[1]);
  const deadline = Date.now() + 5_000;
  let comparison = null;
  while (Date.now() < deadline) {
    const snapshot = readSnapshot(ns, port);
    if (snapshot && Date.now() - snapshot.timestamp <= 1_000) {
      comparison = compare(snapshot, target, findWorkerProcesses(ns));
      if (comparison.valid) break;
    }
    await ns.sleep(100);
  }
  if (!comparison) {
    ns.tprint(`FAIL: no fresh scheduler tracking snapshot on port ${port}.`);
    return;
  }

  ns.tprint(
    `Snapshot age=${Date.now() - comparison.snapshot.timestamp}ms batches=${comparison.batches.length} trackedPids=${comparison.jobs.length}`,
  );
  for (const batch of comparison.batches) {
    ns.tprint(
      `  ${batch.id} target=${batch.target} landing=${new Date(batch.expectedLanding).toLocaleTimeString()} jobs=${batch.operations.length}`,
    );
  }
  ns.tprint(
    `${comparison.valid ? 'PASS' : 'FAIL'}: metadataErrors=${comparison.metadataErrors}, missing=${comparison.missing}, untracked=${comparison.untracked}`,
  );
}

function compare(snapshot, target, live) {
  const batches = batchesForTarget(snapshot, target);
  const jobs = trackedJobs({ batches });
  const liveByPid = new Map(live.map((process) => [processKey(process.host, process.pid), process]));
  const trackedKeys = new Set(jobs.map((job) => processKey(job.host, job.pid)));
  let metadataErrors = 0;
  let missing = 0;

  for (const batch of batches) {
    if (!batch.id || !batch.target || !Number.isFinite(batch.expectedLanding)) metadataErrors += 1;
    for (const job of batch.operations) {
      const process = liveByPid.get(processKey(job.host, job.pid));
      if (!process) {
        missing += 1;
        continue;
      }
      if (
        process.filename !== job.file
        || process.threads !== job.threads
        || String(process.args[0]) !== batch.target
        || String(process.args[3]) !== batch.id
      ) metadataErrors += 1;
    }
  }

  const untracked = live.filter((process) => {
    const id = String(process.args[3] ?? '');
    const matchesTarget = target === null || String(process.args[0]) === target;
    return matchesTarget && id.startsWith('batch-') && !trackedKeys.has(processKey(process.host, process.pid));
  }).length;
  return {
    snapshot,
    batches,
    jobs,
    metadataErrors,
    missing,
    untracked,
    valid: jobs.length > 0 && metadataErrors === 0 && missing === 0 && untracked === 0,
  };
}
