/** @param {NS} ns */
import { getAllServerNames } from './helpers.js';

/**
 * Continuously shares RAM on all servers with factions to increase reputation gain.
 * @param {NS} ns - The Netscript environment.
 *
 * Usage: run shareRam.js
 */
export async function main(ns) {
    const servers = getAllServerNames(ns);
    while (true) {
        for (const server of servers) {
            if (!ns.hasRootAccess(server)) continue;
            const maxRam = ns.getServerMaxRam(server);
            const usedRam = ns.getServerUsedRam(server);
            const availableRam = maxRam - usedRam;
            const margin = 4; // leave 4 GB
            const usableRam = Math.max(0, availableRam - margin);
            const script = 'share.js';
            const scriptRam = ns.getScriptRam(script);
            const threads = Math.floor(usableRam / scriptRam);
            if (threads > 0) {
                if (!ns.fileExists(script, server)) {
                    const success = ns.scp(script, server, 'home');
                    if (!success) {
                        ns.tprint(`${RED}⚠️ Failed to copy ${script} to ${server}${RESET}`);
                    }
                }
                ns.exec(script, server, threads);
            }
        }
        await ns.sleep(1000);
    }
}
