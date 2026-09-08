/** @param {NS} ns */
export async function main(ns) {
  if (!ns.getRunningScript("hacknet-automator.js")) ns.exec("hacknet-automator.js", "home");
  if (!ns.getRunningScript("dynamic-hack-scheduler.js")) ns.exec("dynamic-hack-scheduler.js", "home");
  if (!ns.getRunningScript("purchase-servers.js"))ns.exec("purchase-servers.js", "home");
  if (!ns.getRunningScript("gang-manager.js"))ns.exec("gang-manager.js", "home");
  if (!ns.getRunningScript("Stock-trader.js"))ns.exec("Stock-trader.js", "home");
}