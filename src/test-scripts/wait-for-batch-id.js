/**
 * Silently wait for a normal scheduler batch, print it, and exit.
 *
 * Usage: run wait-for-batch-id.js [target] [pollInterval]
 * Example: run wait-for-batch-id.js n00dles 250
 *
 * Omit target to accept the first normal batch found for any target.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog('ALL');

  const targetFilter = ns.args[0] === undefined ? null : String(ns.args[0]);
  const requestedInterval = Number(ns.args[1] ?? 250);
  const pollInterval = Number.isFinite(requestedInterval) ? Math.max(20, requestedInterval) : 250;
  const workerScripts = new Set(['hack.js', 'grow.js', 'weaken.js']);

  while (true) {
    const visited = new Set(['home']);
    const pending = ['home'];
    const matches = new Map();

    while (pending.length > 0) {
      const host = pending.shift();

      for (const neighbor of ns.scan(host)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }

      for (const process of ns.ps(host)) {
        if (!workerScripts.has(process.filename)) continue;
        if (targetFilter !== null && String(process.args[0]) !== targetFilter) continue;

        const batchId = String(process.args[3] ?? '');
        if (!batchId.startsWith('batch-')) continue;

        const entries = matches.get(batchId) ?? [];
        entries.push({ host, process });
        matches.set(batchId, entries);
      }
    }

    if (matches.size > 0) {
      const [batchId, entries] = matches.entries().next().value;
      ns.tprint(`Found normal batch ${batchId}: ${entries.length} process(es)`);
      for (const { host, process } of entries) {
        ns.tprint(
          `  ${process.filename}@${host} pid=${process.pid} threads=${process.threads} args=${JSON.stringify(
            process.args,
          )}`,
        );
      }
      return;
    }

    await ns.sleep(pollInterval);
  }
}
