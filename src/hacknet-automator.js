/** @param {NS} ns */
// Custom color coding.
const red = "\u001b[31m";
const reset = "\u001b[0m";

function estimateProduction(level, ram, cores) {
  const ramMult = Math.pow(1.035, ram - 1);
  const coreMult = 1 + (cores - 1) / 5;
  return level * ramMult * coreMult;
}

function getBestUpgradeForNode(ns, i) {
  const { level, ram, cores } = ns.hacknet.getNodeStats(i);
  const currentProd = estimateProduction(level, ram, cores);
  const upgradeOptions = [];

  // LEVEL
  const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
  const levelGain = estimateProduction(level + 1, ram, cores) - currentProd;
  upgradeOptions.push({ type: "level", gain: levelGain, cost: levelCost });

  // RAM
  const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
  const ramGain = estimateProduction(level, ram + 1, cores) - currentProd;
  upgradeOptions.push({ type: "ram", gain: ramGain, cost: ramCost });

  // CORES
  const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
  const coreGain = estimateProduction(level, ram, cores + 1) - currentProd;
  upgradeOptions.push({ type: "core", gain: coreGain, cost: coreCost });

  // Add efficiency field and node index
  for (const opt of upgradeOptions) {
    opt.efficiency = opt.gain / opt.cost;
    opt.nodeIndex = i;
  }

  // Sort and return most efficient one
  upgradeOptions.sort((a, b) => b.efficiency - a.efficiency);
  return upgradeOptions[0];
  /** return {
   *    type: "level" | "ram" | "core", 
   *    cost, 
   *    efficiency, 
   *    nodeIndex 
   *  } */
}

function getBestHacknetUpgrade(ns) {
  const numNodes = ns.hacknet.numNodes();
  let bestUpgrade = null;

  for (let i = 0; i < numNodes; i++) {
    const upgrade = getBestUpgradeForNode(ns, i);
    if (upgrade !== null) {
      if (
        bestUpgrade === null ||
        upgrade.efficiency > bestUpgrade.efficiency
      ) {
        bestUpgrade = upgrade;
      }
    }
  }

  // Consider purchasing a new node
  const nodeCost = ns.hacknet.getPurchaseNodeCost();
  const newProd = estimateProduction(1, 1, 1);
  const efficiency = newProd / nodeCost;

  if (
    bestUpgrade === null ||
    efficiency > bestUpgrade.efficiency
  ) {
    bestUpgrade = {
      type: "purchase-node",
      cost: nodeCost,
      gain: newProd,
      efficiency: efficiency
    };
  }

  return bestUpgrade; // may be outside of budget
}

export async function main(ns) {
  const budgetMult = 0.2;
  let budget = ns.getPlayer().money * budgetMult;
  while (true) {
    const upgrade = getBestHacknetUpgrade(ns);
    if (upgrade.cost <= budget) {
      let purchase;
      //buy the upgrade
      switch (upgrade.type) {
        case "level":
          purchase = ns.hacknet.upgradeLevel(upgrade.nodeIndex, 1);
          break;
        case "ram":
          purchase = ns.hacknet.upgradeRam(upgrade.nodeIndex, 1);
          break;
        case "core":
          purchase = ns.hacknet.upgradeCore(upgrade.nodeIndex, 1);
          break;
        case "purchase-node":
          purchase = ns.hacknet.purchaseNode();
          break;
      }
      if (purchase === -1 || purchase === false) {
        ns.print(`${red}ERROR Attempted upgrade purchase failed${reset}`);
        ns.printf("/tbudget = $%.2f", budget);
        ns.printf("/tcost = $%.2f", upgrade.cost);
      } else {
        budget -= upgrade.cost;
      }
    } else {
      budget = ns.getPlayer().money * budgetMult;
      await ns.sleep(1e3);
    }
  }
}