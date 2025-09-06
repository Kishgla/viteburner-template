/**
 * Hack a server once, optionally affecting the target's stock price.
 * 
 * @param {NS} ns - The Netscript environment.
 * @param {string} target - The target server to hack.
 * @param {boolean} useStock - Whether to use stock market mechanics.
 * @param {number} [delay=0] - Optional delay in milliseconds before starting the hack operation.
 * 
 * Usage: run hack.js <target> [useStock]
 * 
 * Notes:
 * - If useStock is true, this action will lower the stock price of the target's company.
 * - This script performs a single hack operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  const target = ns.args[0];
  const delay = Number(ns.args[1] ?? 0);
  if (delay > 0) await ns.sleep(delay);
  await ns.weaken(target);
}