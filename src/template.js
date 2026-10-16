export async function main(ns) {
  ns.tprint(`Script income: ${ns.getScriptIncome("dynamic-hack-scheduler.js")}/sec`);
}