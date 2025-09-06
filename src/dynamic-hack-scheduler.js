/** @param {NS} ns */
import {
  getAllServerNames, 
  getServerObjects,
  updateTargetFlags,
  refreshServers,
  countAvailablePortOpeners, 
  runAvailablePortOpeners
  } from "helpers.js";

/***********************************************\
 * Config                                      *
\***********************************************/

const WEAKEN = "weaken.js";
const GROW = "grow.js";
const HACK = "hack.js";

const SECURITY_BUFFER = 5;        //
const FUNDING_THRESHOLD = 0.95;   //

//ANSI colors for tprint
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

function sortWorkers(workers) {
  workers.sort((a, b) => (b.data.maxRam - b.data.ramUsed) - (a.data.maxRam - a.data.ramUsed));
}

function assignWeaken(ns, target, workers) {
  const secDiff = target.data.hackDifficulty - target.data.minDifficulty;
  if (secDiff <= 0) return true; // No weakening needed, skip the rest of this function

  // Estimate number of threads needed
  const securityReductionPerThread = 0.05;
  const threadsNeeded = Math.ceil(secDiff / securityReductionPerThread);

  return assignOperation(ns, {
    opName: WEAKEN,
    target,
    workers,
    threadsNeeded
  });
}

function assignGrow(ns, target, workers) {
  // Figure out how much money to grow
  const currentMoney = target.data.moneyAvailable;
  const maxMoney = target.data.moneyMax;
  if (currentMoney >= maxMoney) return true; // No grow needed

  // Estimate threads required
  const growthMult = maxMoney / Math.max(currentMoney, 1);
  const threadsNeeded = Math.ceil(ns.growthAnalyze(target.name, growthMult));

  return assignOperation(ns, {
    opName: GROW,
    target,
    workers,
    threadsNeeded,
    useStockGrowth: target.stockImpact === "bull"
  });
}

function assignHack(ns, target, workers) {
  // Decide how much money to steal
  const stealRatio = 0.5;
  const moneyToSteal = target.data.moneyAvailable * stealRatio;

  // Estimate threads required
  const threadsNeeded = Math.ceil(ns.hackAnalyzeThreads(target.name, moneyToSteal));
  if (!isFinite(threadsNeeded) || threadsNeeded <= 0) return true;

  return assignOperation(ns, {
    opName: HACK,
    target,
    workers,
    threadsNeeded,
    useStockGrowth: target.stockImpact === "bear"
  });
}

function assignOperation(ns, {
  opName,   // string: WEAKEN | GROW | HACK
  target,
  workers,
  threadsNeeded,
  useStockGrowth = false
}) {
  const type = COOLDOWN_TYPES[opName];
  if (Date.now() < target.cooldowns[type]) return true;

  sortWorkers(workers);

  const scriptRam = ns.getScriptRam(opName);
  let threadsRemaining = threadsNeeded;

  for (const worker of workers) {
    worker.data = ns.getServer(worker.name);
    const availableRam = worker.data.maxRam - worker.data.ramUsed;
    const ramFactor = (worker.name === "home") ? 0.8 : 1.0;
    const effectiveRam = availableRam * ramFactor;
    const maxThreads = Math.floor(effectiveRam / scriptRam);
    if (maxThreads <= 0) continue;

    const threadsToUse = Math.min(maxThreads, threadsRemaining);

    const pid = ns.exec(opName, worker.name, threadsToUse, target.name, useStockGrowth);
    if (pid === 0) {
      //ns.tprint(`${YELLOW}⚠️ Failed to exec ${opName} on ${worker.name}${RESET}`);
      ns.tprint(
        `${RED}⚠️ Failed to exec ${opName} on ${worker.name}${RESET}\n` +
        `  └─ Threads attempted: ${threadsToUse}\n` +
        `  └─ Available RAM: ${availableRam.toFixed(2)} GB\n` +
        `  └─ Script RAM: ${scriptRam.toFixed(2)} GB\n` +
        `  └─ Target: ${target.name}\n` +
        `  └─ useStockGrowth: ${useStockGrowth}${RESET}`
      );
      if (!ns.fileExists(opName, worker.name)) {
        ns.tprint(`${YELLOW}⚠️ Script ${opName} not found on ${worker.name}${RESET}`);
      }
      if (maxThreads <= 0 && availableRam < scriptRam) {
        ns.print(`${YELLOW}⚠️ ${worker.name} has insufficient RAM (${availableRam.toFixed(2)} GB) for ${opName}${RESET}`);
      }
      return false;
    } else {
      threadsRemaining -= threadsToUse;
    }

    if (threadsRemaining <= 0) break;
  }

  // Set cooldown if any threads were dispatched
  if (threadsRemaining < threadsNeeded) {
    const cooldownTime =
      opName === WEAKEN ? ns.getWeakenTime(target.name) :
        opName === GROW ? ns.getGrowTime(target.name) :
          opName === HACK ? ns.getHackTime(target.name) :
            0;

    target.cooldowns[type] = Date.now() + cooldownTime;
  }

  return true;
}

function copyScriptsToWorker(ns, workerName) {
  const scripts = [WEAKEN, GROW, HACK];
  for (const script of scripts) {
    if (!ns.fileExists(script, workerName)) {
      const success = ns.scp(script, workerName, "home");
      if (!success) {
        ns.tprint(`${RED}⚠️ Failed to copy ${script} to ${workerName}${RESET}`);
        return false;
      }
    }
  }
  return true;
}

function tryGainRootAccess(ns, target) {
  if (target.data.hasAdminRights) return true;

  const availablePortOpeners = countAvailablePortOpeners(ns);
  if (availablePortOpeners >= target.data.numOpenPortsRequired) {
    runAvailablePortOpeners(ns, target.name);
    if (!ns.nuke(target.name)) {
      ns.tprint(`${YELLOW}⚠️ Failed to nuke ${target.name}${RESET}`)
      return false;
    } else {
      ns.print(`🌐 Gained root on ${target.name}`);
    }
  }
  return true;
}

export async function main(ns) {
  while (true) {
    // Discover servers
    const serverNames = getAllServerNames(ns);
    const allServers = getServerObjects(ns, serverNames, SECURITY_BUFFER, FUNDING_THRESHOLD);
    const hackingLevel = ns.getHackingLevel();

    // Try to root all servers
    for (const target of allServers) {
      if (!tryGainRootAccess(ns, target)) {
        ns.tprint(`${YELLOW}⚠️ Failed to root ${target.name}${RESET}`)
        await ns.sleep(10000);
      }
    }

    const workers = allServers.filter(s =>
      s.data.hasAdminRights &&
      s.data.maxRam > 0 
      //&& s.name !== "home"
    );

    for (const worker of workers) {
      const success = copyScriptsToWorker(ns, worker.name);
      if (!success) {
        ns.tprint(`${RED}⚠️ Failed to copy a script to ${worker.name}${RESET}`);
        await ns.sleep(10000);
      }
    }

    ns.print(`${workers.length} workers`);

    const viableTargets = allServers.filter(s =>
      s.data.hasAdminRights &&
      s.data.moneyMax > 0 &&
      s.data.requiredHackingSkill <= hackingLevel
    );
    refreshServers(ns, viableTargets);
    updateTargetFlags(viableTargets, SECURITY_BUFFER, FUNDING_THRESHOLD);
    viableTargets.sort((a, b) => {
      const scoreA = a.maxMoney / a.minSecurity;
      const scoreB = b.maxMoney / b.minSecurity;
      return scoreB - scoreA;
    });

    ns.print(`${viableTargets.length} viable targets`);

    // Decide what actions are needed on each server
    for (const target of viableTargets) {
      /*ns.print(
        `Evaluating target: ${target.name}\n` +
        `  └─ targetMode = ${target.targetMode}\n` +
        `  └─ needsWeaken = ${target.needsWeaken}\n` + 
        `  └─ needsGrow = ${target.needsGrow}\n`
      );*/
      let success;
      if (target.targetMode === "prep") {
        ns.print(`Prepping ${target.name}...`);
        if (target.needsWeaken) {
          success = assignWeaken(ns, target, workers);
          if (!success) {
            ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
            await ns.sleep(10000);
          }
        } else if (target.needsGrow) {
          success = assignGrow(ns, target, workers, target.stockImpact === "bull");
          if (!success) {
            ns.print(`${RED}⚠️ assignGrow() returned an error${RESET}`);
            await ns.sleep(10000);
          }
        }
      } else if (target.targetMode === "farm") {
        ns.print(`Farming ${target.name}`);
        success = assignWeaken(ns, target, workers);
        if (!success) {
          ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
          await ns.sleep(10000);
        }
        success = assignGrow(ns, target, workers, target.stockImpact === "bull");
        if (!success) {
          ns.print(`${RED}⚠️ assignGrow() returned an error${RESET}`);
          await ns.sleep(10000);
        }
        success = assignWeaken(ns, target, workers);
        if (!success) {
          ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
          await ns.sleep(10000);
        }
        success = assignHack(ns, target, workers, target.stockImpact === "bear")
        if (!success) {
          ns.print(`${RED}⚠️ assignHack() returned an error${RESET}`);
          await ns.sleep(10000);
        }
      } else {
        ns.print(`${YELLOW}⚠️ ${target.targetMode} is an invalid target mode for ${target.name}${RESET}`);
      }
    }

    await ns.sleep(1000);
  }
}