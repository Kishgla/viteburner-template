import { findWorkerProcesses } from './batch-tracking-helpers.js';

const PREP_PATTERN = /^prep-(grow|weaken)-[a-zA-Z0-9_-]+-[0-9a-z]+-\d+-\d+$/;
const NORMAL_PATTERN = /^batch-[a-zA-Z0-9_-]+-[0-9a-z]+-\d+-\d+$/;

/**
 * Wait for and validate scheduler-created prep IDs.
 * Put the target into a prep state before starting the scheduler.
 * Usage: run test-scripts/prep-id-test.js [target] [expectedKind=grow|weaken|either] [timeout=60000]
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = ns.args[0] === undefined ? null : String(ns.args[0]);
  const expectedKind = String(ns.args[1] ?? 'either');
  const timeout = Math.max(1_000, Number(ns.args[2] ?? 60_000));
  const deadline = Date.now() + timeout;
  let groups = new Map();

  while (Date.now() < deadline) {
    const matches = findWorkerProcesses(ns).filter((process) => {
      const id = String(process.args[3] ?? '');
      return id.startsWith('prep-') && (target === null || String(process.args[0]) === target);
    });
    groups = groupCompletePreps(matches, expectedKind);
    if (groups.size > 0) break;
    await ns.sleep(50);
  }
  if (groups.size === 0) {
    const expected = expectedKind === 'grow' ? 'complete grow/weaken prep pair' : `${expectedKind} prep`;
    ns.tprint(`FAIL: no ${expected}${target ? ` for ${target}` : ''} appeared before timeout.`);
    return;
  }

  const errors = [];
  for (const [id, entries] of groups) {
    if (!PREP_PATTERN.test(id)) errors.push(`${id}: invalid prep ID format`);
    if (NORMAL_PATTERN.test(id)) errors.push(`${id}: prep ID overlaps the normal batch namespace`);
    const kind = id.startsWith('prep-grow-') ? 'grow' : 'weaken';
    if (expectedKind !== 'either' && kind !== expectedKind) errors.push(`${id}: expected ${expectedKind} prep`);
    const files = new Set(entries.map((entry) => entry.filename));
    if (kind === 'grow' && (!files.has('grow.js') || !files.has('weaken.js'))) {
      errors.push(`${id}: grow prep does not share its ID across grow and weaken workers`);
    }
    if (kind === 'weaken' && [...files].some((file) => file !== 'weaken.js')) {
      errors.push(`${id}: weaken prep contains a non-weaken worker`);
    }
    for (const entry of entries) {
      if (entry.args.length !== 4 || String(entry.args[3]) !== id) {
        errors.push(`${id}: invalid worker arguments ${JSON.stringify(entry.args)}`);
      }
    }
    ns.tprint(`  ${id}: ${entries.length} portion(s), files=${[...files].join(',')}`);
  }

  for (const error of errors) ns.tprint(`  ERROR: ${error}`);
  ns.tprint(`${errors.length === 0 ? 'PASS' : 'FAIL'}: checked ${groups.size} scheduler-created prep ID(s).`);
}

function groupCompletePreps(matches, expectedKind) {
  const groups = new Map();
  for (const process of matches) {
    const id = String(process.args[3] ?? '');
    const entries = groups.get(id) ?? [];
    entries.push(process);
    groups.set(id, entries);
  }

  return new Map(
    [...groups].filter(([id, entries]) => {
      const files = new Set(entries.map((entry) => entry.filename));
      const kind = id.startsWith('prep-grow-') ? 'grow' : 'weaken';
      if (expectedKind !== 'either' && kind !== expectedKind) return false;
      if (kind === 'grow') return files.has('grow.js') && files.has('weaken.js');
      return files.has('weaken.js') && [...files].every((file) => file === 'weaken.js');
    }),
  );
}
