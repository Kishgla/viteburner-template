const MAX_RAM = 2 ** 20;
const RAM_MULT = 2;
const BUDGET_RATIO = 0.2;
const RED = '\x1B[31m';
const YELLOW = '\x1B[33m';
const RESET = '\x1B[0m';
function getMaxAffordableRam(ns, budget) {
  let ram = 2;
  while (ram <= MAX_RAM && ns.getPurchasedServerCost(ram * 2) < budget) {
    ram *= 2;
  }
  return ram;
}
function getSmallestOwnedServer(ns) {
  const servers = ns.getPurchasedServers();
  if (servers.length === 0) return null;
  let smallest = servers[0];
  for (let server of servers) {
    if (ns.getServerMaxRam(server) < ns.getServerMaxRam(smallest)) {
      smallest = server;
    }
  }
  return smallest;
}

/**
 *
 * @param {NS} ns - The Netscript environment.
 *
 * Usage: run purchase-servers.js
 *
 * Notes:
 * - This script continuously attempts to purchase or upgrade servers based on available budget.
 * - It maintains a budget defined as a fraction of the player's total money.
 * - If the maximum number of servers is reached, it will replace the smallest server if the new one is larger.
 */
export async function main(ns) {
  const maxServers = ns.getPurchasedServerLimit();
  while (true) {
    const budget = ns.getPlayer().money * BUDGET_RATIO;
    const ramToBuy = getMaxAffordableRam(ns, budget);
    const smallestServer = getSmallestOwnedServer(ns);
    const serversOwned = ns.getPurchasedServers().length;
    const newServerName = `Server-${serversOwned.toString().padStart(2, '0')}`;
    if (ns.getPurchasedServerCost(ramToBuy) < budget) {
      if (serversOwned < maxServers) {
        const ret = ns.purchaseServer(newServerName, ramToBuy);
        if (ret === '') {
          ns.tprint(
            `${YELLOW}⚠️ ns.purchaseServer() failed${RESET}\n` +
            `  └─ newServerName = ${newServerName}\n` +
            `  └─ ramToBuy = ${ramToBuy}\n`,
          );
        }
      } else if (ramToBuy > ns.getServerMaxRam(smallestServer)) {
        ns.killall(smallestServer);
        if (!ns.deleteServer(smallestServer)) {
          ns.tprint(`${YELLOW}⚠️ ns.deleteServer() failed${RESET}\n` + `  └─ smallestServer = ${smallestServer}`);
        } else {
          const ret = ns.purchaseServer(smallestServer, ramToBuy);
          if (ret === '') {
            ns.tprint(
              `${YELLOW}⚠️ ns.purchaseServer() failed${RESET}\n` +
              `  └─ smallestServer = ${smallestServer}\n` +
              `  └─ ramToBuy = ${ramToBuy}`,
            );
          }
        }
      } else {
        ns.print(`Best purchase within budget is less than smallest server`);
      }
    } else {
      ns.print(`Insufficient funds for upgrade`);
    }
    await ns.sleep(1e4);
  }
}
