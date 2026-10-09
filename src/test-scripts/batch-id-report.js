/**
 * Temporary read-only report for scheduler worker arguments.
 *
 * Usage: run batch-id-report.js [target]
 * Omitting target reports every running hack/grow/weaken worker in the network.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  const targetFilter = ns.args[0] === undefined ? null : String(ns.args[0]);
  const workers = new Set(['hack.js', 'grow.js', 'weaken.js']);
  const visited = new Set(['home']);
  const pending = ['home'];
  const groups = new Map();

  while (pending.length > 0) {
    const host = pending.shift();
    for (const neighbor of ns.scan(host)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    for (const process of ns.ps(host)) {
      if (!workers.has(process.filename)) continue;
      if (targetFilter !== null && String(process.args[0]) !== targetFilter) continue;

      const batchId = String(process.args[3] ?? '<missing>');
      const entries = groups.get(batchId) ?? [];
      entries.push({ host, process });
      groups.set(batchId, entries);
    }
  }

  if (groups.size === 0) {
    ns.tprint('No matching scheduler workers are running.');
    return;
  }

  for (const [batchId, entries] of groups) {
    ns.tprint(`ID ${batchId}: ${entries.length} process(es)`);
    for (const { host, process } of entries) {
      ns.tprint(
        `  ${process.filename}@${host} pid=${process.pid} threads=${process.threads} args=${JSON.stringify(
          process.args,
        )}`,
      );
    }
  }
}
