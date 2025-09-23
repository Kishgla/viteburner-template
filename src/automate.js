/** @param {NS} ns */
export async function main(ns) {
  ns.exec("hacknet-automator.js", "home");
  ns.exec("dynamic-hack-scheduler.js", "home");
  ns.exec("purchase-servers.js", "home");
  ns.exec("gang-manager.js", "home");
  ns.exec("Stock-trader.js", "home");
}