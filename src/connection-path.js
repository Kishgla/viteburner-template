import { getServerPath } from './helpers.js';

/** @param {NS} ns */
export async function main(ns) {
  const target = String(ns.args[0] ?? '').trim();

  if (!target) {
    ns.tprint(`Usage: run ${ns.getScriptName()} <server>`);
    return;
  }

  const path = getServerPath(ns, target);

  if (path === null) {
    ns.tprint(`ERROR: Could not find server "${target}".`);
    return;
  }

  ns.tprint(path.join(' -> '));
}
