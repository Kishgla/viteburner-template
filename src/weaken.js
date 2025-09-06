/**
 * Weaken a server to reduce its security level.
 * 
 * @param {NS} ns - The Netscript environment.
 * @param {string} target - The target server to weaken.
 * 
 * Usage: run weaken.js <target>
 * 
 * Notes:
 * - This script performs a single weaken operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  const target = ns.args[0];
  await ns.weaken(target);
}