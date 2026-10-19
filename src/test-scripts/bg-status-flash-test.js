/** @param {NS} ns */
export async function main(ns) {
  ns.tprint("INFO: This is an info.");
  await ns.sleep(10000);
  ns.tprint("WARN: This is a warning.");
  await ns.sleep(10000);
  ns.tprint("ERROR: This is an error.");
}