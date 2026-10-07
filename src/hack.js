/**
 * Hack a server once, optionally affecting the target's stock price.
 *
 * @param {NS} ns - The Netscript environment.
 * @param {string} target - The target server to hack.
 * @param {boolean} useStock - Whether to use stock market mechanics.
 * @param {number} [delay=0] - Optional delay in milliseconds before starting the hack operation.
 * @param {string} [batchId] - Optional identifier used to distinguish batch processes.
 *
 * Usage: run hack.js [--debug] <target> [useStock] [delay] [batchId]
 *
 * Notes:
 * - If useStock is true, this action will lower the stock price of the target's company.
 * - This script performs a single hack operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  const flags = ns.flags([['debug', false]]);
  const target = flags._[0];
  const useStock = !!flags._[1];
  const delay = Number(flags._[2] ?? 0);
  if (delay > 0) await ns.sleep(delay);
  const amountStolen = await ns.hack(target, { stock: useStock });
  if (flags.debug) {
    const message = `hack.js returned ${ns.format.number(amountStolen, 2)} from ${target}.`;
    ns.print(message);
    ns.tprint(message);
  }
}
