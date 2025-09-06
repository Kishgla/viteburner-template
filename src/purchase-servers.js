/** @param {NS} ns */
const MAX_RAM = 2 ** 20; // Bitburner's max server RAM
const RAM_MULT = 2; // stepwise upgrade multiplier (like 8 → 16 → 32)
const BUDGET_RATIO = 0.2; // max 20% of player money spent

//ANSI colors ⚠️
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

/**
 * Returns the size of the largest server that is within the budget
 * @param {NS} ns, {number} budget
 * @return {number} ram
 */
function getMaxAffordableRam(ns, budget) {
  let ram = 2; // minimum server size
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
        // buy a new server with ramToBuy
        const ret = ns.purchaseServer(newServerName, ramToBuy);
        if (ret === "") {
          ns.tprint(
            `${YELLOW}⚠️ ns.purchaseServer() failed${RESET}\n` +
            `  └─ newServerName = ${newServerName}\n` +
            `  └─ ramToBuy = ${ramToBuy}`
          );
        }
      } else if (ramToBuy > ns.getServerMaxRam(smallestServer)) {
        // replace the smallest server with a new one
        ns.killall(smallestServer);
        if (!ns.deleteServer(smallestServer)) {
          ns.tprint(
            `${YELLOW}⚠️ ns.deleteServer() failed${RESET}\n` +
            `  └─ smallestServer = ${smallestServer}`
          );
        } else {
          const ret = ns.purchaseServer(smallestServer, ramToBuy);
          if (ret === "") {
            ns.tprint(
              `${YELLOW}⚠️ ns.purchaseServer() failed${RESET}\n` +
              `  └─ smallestServer = ${smallestServer}\n` +
              `  └─ ramToBuy = ${ramToBuy}`
            );
          }
        }
      } else {
        ns.print(`Best purchase within budget is less than smallest server`);
      }
    } else {
      ns.print(`Insufficient funds for upgrade`);
    }

    await ns.sleep(10000);
  }
}