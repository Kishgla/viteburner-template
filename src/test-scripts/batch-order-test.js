import { batchesForTarget, findWorkerProcesses, processKey, waitForSnapshot } from './batch-tracking-helpers.js';

const POLL_INTERVAL = 5;
const TIMING_TOLERANCE = 250;

/**
 * Observe the completion order of a real scheduler-created batch.
 * Start it first with: run dynamic-hack-scheduler.js 20
 * Usage: run test-scripts/batch-order-test.js [port=20] [target] [timeout=60000]
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const port = Number(ns.args[0] ?? 20);
  const target = ns.args[1] === undefined ? null : String(ns.args[1]);
  const timeout = Math.max(1_000, Number(ns.args[2] ?? 60_000));
  const snapshot = await waitForSnapshot(
    ns,
    port,
    (value) => Date.now() - value.timestamp <= 1_000 && batchesForTarget(value, target).length > 0,
    timeout,
  );
  if (!snapshot) {
    ns.tprint(`FAIL: no scheduler batch${target ? ` for ${target}` : ''} appeared on port ${port}.`);
    return;
  }

  const live = findWorkerProcesses(ns);
  const liveByPid = new Map(live.map((process) => [processKey(process.host, process.pid), process]));
  const candidate = batchesForTarget(snapshot, target)
    .map((batch) => ({ batch, groups: logicalOperations(ns, batch, liveByPid) }))
    .find(({ groups }) => groups.length === 4
      && groups.every((group) => group.jobs.length > 0)
      && groups.map((group) => group.file).join(',') === 'hack.js,weaken.js,grow.js,weaken.js');
  if (!candidate) {
    ns.tprint('FAIL: no complete, live HWGW batch was available to observe.');
    return;
  }

  const { batch, groups } = candidate;
  const expectedLabels = ['hack', 'weaken-hack', 'grow', 'weaken-grow'];
  const completions = [];
  const deadline = Date.now() + timeout;
  ns.tprint(`Observing ${batch.id}; expected ${expectedLabels.join(' -> ')}`);

  while (completions.length < groups.length && Date.now() < deadline) {
    const liveKeys = new Set(findWorkerProcesses(ns).map((process) => processKey(process.host, process.pid)));
    for (const group of groups) {
      if (completions.some((entry) => entry.key === group.key)) continue;
      if (group.jobs.every((job) => !liveKeys.has(processKey(job.host, job.pid)))) {
        const completedAt = Date.now();
        completions.push({ ...group, completedAt });
        ns.tprint(`  ${group.label} completed (${formatSigned(completedAt - group.expectedLanding)} ms from expected)`);
      }
    }
    if (completions.length < groups.length) await ns.sleep(POLL_INTERVAL);
  }

  const actual = completions.map((entry) => entry.label);
  const orderCorrect = expectedLabels.every((label, index) => actual[index] === label);
  const timingCorrect = completions.length === 4
    && completions.every((entry) => Math.abs(entry.completedAt - entry.expectedLanding) <= TIMING_TOLERANCE);
  ns.tprint(`${orderCorrect && timingCorrect ? 'PASS' : 'FAIL'}: actual=${actual.join(' -> ') || '<timeout>'}; timing tolerance=±${TIMING_TOLERANCE}ms.`);
}

function logicalOperations(ns, batch, liveByPid) {
  const createdAt = parseCreatedAt(batch.id);
  if (createdAt === null) return [];
  const grouped = [];
  for (const job of batch.operations) {
    const process = liveByPid.get(processKey(job.host, job.pid));
    if (!process) continue;
    const delay = Math.max(0, Number(process.args[2]) || 0);
    const actionTime = job.file === 'hack.js'
      ? ns.getHackTime(batch.target)
      : job.file === 'grow.js'
        ? ns.getGrowTime(batch.target)
        : ns.getWeakenTime(batch.target);
    const expectedLanding = createdAt + delay + actionTime;
    let group = grouped.find((entry) => entry.file === job.file
      && Math.abs(entry.expectedLanding - expectedLanding) <= 20);
    if (!group) {
      group = {
        key: `${job.file}|${delay}`,
        file: job.file,
        jobs: [],
        expectedLanding,
      };
      grouped.push(group);
    }
    group.jobs.push(job);
  }

  const ordered = grouped.sort((a, b) => a.expectedLanding - b.expectedLanding);
  const labels = ['hack', 'weaken-hack', 'grow', 'weaken-grow'];
  for (let index = 0; index < ordered.length; index++) ordered[index].label = labels[index] ?? ordered[index].file;
  return ordered;
}

function parseCreatedAt(batchId) {
  const match = batchId.match(/-([0-9a-z]+)-\d+-\d+$/);
  if (!match) return null;
  const value = parseInt(match[1], 36);
  return Number.isFinite(value) ? value : null;
}

function formatSigned(value) {
  return `${value >= 0 ? '+' : ''}${value}`;
}
