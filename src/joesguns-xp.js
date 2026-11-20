/**
 * Compatibility notice for the former standalone XP coordinator.
 * XP overflow is now owned directly by dynamic-hack-scheduler.js.
 *
 * @param {NS} ns - The Netscript environment.
 */
export function main(ns) {
  ns.tprint('joesguns-xp.js is retired. Start dynamic-hack-scheduler.js with --xp instead.');
}
