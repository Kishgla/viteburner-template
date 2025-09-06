/** @param {NS} ns */
// Custom color coding.
const cyan = "\u001b[36m";
const green = "\u001b[32m";
const red = "\x1b[31m";
const reset = "\x1b[0m";
const orange = "\u001b[38;5;208m";
const orange_bg = "\u001b[48;5;208m";

export async function main(ns) {
  while (true) {
    ns.tprint(`${cyan}⚠️ this is not red text${reset}`);
    await ns.sleep(10000)
  }
}