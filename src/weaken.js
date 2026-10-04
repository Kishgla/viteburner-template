/**
 * Weaken a server to reduce its security level.
 *
 * @param {NS} ns - The Netscript environment.
 * @param {string} target - The target server to weaken.
 * @param {boolean} [useStock=false] - Unused; retained for a consistent worker interface.
 * @param {number} [delay=0] - Optional delay in milliseconds before starting the weaken operation.
 * @param {string} [batchId] - Optional identifier used to distinguish batch processes.
 *
 * Usage: run weaken.js <target> [useStock] [delay] [batchId]
 *
 * Notes:
 * - This script performs a single weaken operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  const target = ns.args[0];
  const delay = Number(ns.args[2] ?? 0);
  if (delay > 0) await ns.sleep(delay);
  await ns.weaken(target);
}
