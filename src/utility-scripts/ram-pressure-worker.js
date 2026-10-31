/** Hold allocated RAM until the pressure controller stops this process. @param {NS} ns */
export async function main(ns) {
  while (true) await ns.sleep(60_000);
}
