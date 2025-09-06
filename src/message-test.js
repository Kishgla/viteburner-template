/** @param {NS} ns */
//ANSI colors
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

export async function main(ns) {
  ns.tprint(`${YELLOW}⚠️ This is a test warning${RESET}`);
}