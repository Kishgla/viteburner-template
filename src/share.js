/** 
 * Shares ram on current server with factions to increase reputation gain.
 * 
 * @param {NS} ns
 * 
 * Usage: run share.js
 * 
 * Notes:
 * - This script performs a single share operation then exits. It is inteded to be scheduled by a controller.
 */
export async function main(ns) {
  await ns.share();
}