/**
 * Temporary in-game smoke test for scheduler worker IDs.
 *
 * Usage: run batch-id-test.js [target] [secondHost]
 * Jobs are given a long delay, inspected, and killed before they can act.
 * Supplying a rooted RAM host also verifies the same split-job signature can
 * launch on two different hosts.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  const target = String(ns.args[0] ?? 'n00dles');
  const secondHost = ns.args[1] === undefined ? null : String(ns.args[1]);
  const delay = 60_000;
  const batchId = `test-batch-${Date.now()}`;
  const otherBatchId = `${batchId}-next`;
  const launches = [];

  const launch = (script, host, operationDelay, id) => {
    const pid = ns.exec(script, host, 1, target, false, operationDelay, id);
    launches.push({ pid, host, script, id });
    return pid;
  };

  launch('weaken.js', 'home', delay, batchId);
  launch('grow.js', 'home', delay + 120, batchId);
  launch('weaken.js', 'home', delay + 240, batchId);
  launch('hack.js', 'home', delay + 360, batchId);
  launch('hack.js', 'home', delay + 360, otherBatchId);

  if (secondHost) {
    await ns.scp(['hack.js'], secondHost, 'home');
    launch('hack.js', secondHost, delay + 360, batchId);
  }

  const failed = launches.filter((job) => job.pid === 0);
  const running = launches
    .filter((job) => job.pid !== 0)
    .map((job) => ns.ps(job.host).find((process) => process.pid === job.pid))
    .filter(Boolean);

  ns.tprint(`Batch ID test: ${running.length}/${launches.length} jobs launched.`);
  for (const process of running) {
    ns.tprint(`${process.filename} pid=${process.pid} args=${JSON.stringify(process.args)}`);
  }
  if (failed.length > 0) {
    ns.tprint(`FAILED launches: ${failed.map((job) => `${job.script}@${job.host}`).join(', ')}`);
  }

  for (const job of launches) {
    if (job.pid !== 0) ns.kill(job.pid);
  }
  ns.tprint('Test jobs cleaned up before execution.');
}
