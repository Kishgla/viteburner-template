/**
 * Grow a server, optionally affecting the target's stock price.
 * 
 * @param {NS} ns - The Netscript environment.
 * @param {string} target - The target server to grow.
 * @param {boolean} useStock - Whether to use stock market mechanics.
 * @param {number} [delay=0] - Optional delay in milliseconds before starting the grow operation.
 * 
 * Usage: run grow.js <target> [useStock]
 * 
 * Notes:
 * - If useStock is true, this action will raise the stock price of the target's company.
 * - This script performs a single grow operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  const target = ns.args[0];
  const useStock = !!ns.args[1];
  const delay = Number(ns.args[2] ?? 0);
  if (delay > 0) await ns.sleep(delay);
  await ns.grow(target, { stock: useStock });
}