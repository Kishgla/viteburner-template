import * as helpers from "/helpers.js";
const RED = "\x1B[31m";
const YELLOW = "\x1B[33m";
const RESET = "\x1B[0m";
const WEAKEN = "/weaken.js";
const GROW = "/grow.js";
const HACK = "/hack.js";
const SECURITY_BUFFER = 5;
const FUNDING_THRESHOLD = 0.9;
const COOLDOWN_TYPES = {
  WEAKEN: "weaken",
  GROW: "grow",
  HACK: "hack"
};
function sortWorkers(workers) {
  workers.sort((a, b) => b.data.maxRam - b.data.ramUsed - (a.data.maxRam - a.data.ramUsed));
}
function assignWeaken(ns, target, workers) {
  const secDiff = target.data.hackDifficulty - target.data.minDifficulty;
  if (secDiff <= 0)
    return true;
  const securityReductionPerThread = 0.05;
  const threadsNeeded = Math.ceil(secDiff / securityReductionPerThread);
  return assignOperation(ns, {
    opName: WEAKEN,
    target,
    workers,
    threadsNeeded
  });
}
function assignGrow(ns, target, workers, stockImpact) {
  const currentMoney = target.data.moneyAvailable;
  const maxMoney = target.data.moneyMax;
  if (currentMoney >= maxMoney)
    return true;
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
function assignHack(ns, target, workers, stockImpact) {
  const stealRatio = 0.5;
  const moneyToSteal = target.data.moneyAvailable * stealRatio;
  const threadsNeeded = Math.ceil(ns.hackAnalyzeThreads(target.name, moneyToSteal));
  if (!isFinite(threadsNeeded) || threadsNeeded <= 0)
    return true;
  return assignOperation(ns, {
    opName: HACK,
    target,
    workers,
    threadsNeeded,
    useStockGrowth: target.stockImpact === "bear"
  });
}
function assignOperation(ns, {
  opName,
  // string: WEAKEN | GROW | HACK
  target,
  workers,
  threadsNeeded,
  useStockGrowth = false
}) {
  const type = COOLDOWN_TYPES[opName];
  if (Date.now() < target.cooldowns[type])
    return true;
  sortWorkers(workers);
  const scriptRam = ns.getScriptRam(opName);
  let threadsRemaining = threadsNeeded;
  for (const worker of workers) {
    worker.data = ns.getServer(worker.name);
    const ramFactor = worker.name === "home" ? 0.8 : 1;
    const availableRam = (worker.data.maxRam * ramFactor) - worker.data.ramUsed;
    const maxThreads = Math.floor(availableRam / scriptRam);
    if (maxThreads <= 0)
      continue;
    const threadsToUse = Math.min(maxThreads, threadsRemaining);
    const pid = ns.exec(opName, worker.name, threadsToUse, target.name, useStockGrowth);
    if (pid === 0) {
      ns.tprint(
        `${RED}⚠️ Failed to exec ${opName} on ${worker.name}${RESET}
  └─ Threads attempted: ${threadsToUse}
  └─ Available RAM: ${availableRam.toFixed(2)} GB
  └─ Script RAM: ${scriptRam.toFixed(2)} GB
  └─ Target: ${target.name}
  └─ useStockGrowth: ${useStockGrowth}${RESET}`
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
    if (threadsRemaining <= 0)
      break;
  }
  if (threadsRemaining < threadsNeeded) {
    const cooldownTime = opName === WEAKEN ? ns.getWeakenTime(target.name) : opName === GROW ? ns.getGrowTime(target.name) : opName === HACK ? ns.getHackTime(target.name) : 0;
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
  if (target.data.hasAdminRights)
    return true;
  const availablePortOpeners = helpers.countAvailablePortOpeners(ns);
  if (availablePortOpeners >= target.data.numOpenPortsRequired) {
    helpers.runAvailablePortOpeners(ns, target.name);
    if (!ns.nuke(target.name)) {
      ns.tprint(`${YELLOW}⚠️ Failed to nuke ${target.name}${RESET}`);
      return false;
    } else {
      ns.tprint(`🌐 Gained root on ${target.name}`);
    }
  }
  return true;
}
export async function main(ns) {
  while (true) {
    const serverNames = helpers.getAllServerNames(ns);
    const allServers = helpers.getServerObjects(ns, serverNames, SECURITY_BUFFER, FUNDING_THRESHOLD);
    const hackingLevel = ns.getHackingLevel();
    for (const target of allServers) {
      if (!tryGainRootAccess(ns, target)) {
        ns.tprint(`${YELLOW}⚠️ Failed to root ${target.name}${RESET}`);
        await ns.sleep(1e4);
      }
    }
    const workers = allServers.filter(
      (s) => s.data.hasAdminRights && s.data.maxRam > 0 //&& s.name !== "home"
    );
    for (const worker of workers) {
      const success = copyScriptsToWorker(ns, worker.name);
      if (!success) {
        ns.tprint(`${RED}⚠️ Failed to copy a script to ${worker.name}${RESET}`);
        await ns.sleep(1e4);
      }
    }
    const viableTargets = allServers.filter(
      (s) => s.data.hasAdminRights && s.data.moneyMax > 0 && s.data.requiredHackingSkill <= hackingLevel
    );
    helpers.refreshServers(ns, viableTargets);
    helpers.updateTargetFlags(viableTargets, SECURITY_BUFFER, FUNDING_THRESHOLD);
    viableTargets.sort((a, b) => {
      const scoreA = a.data.moneyMax / a.data.minSecurity;
      const scoreB = b.data.moneyMax / b.data.minSecurity;
      return scoreB - scoreA;
    });
    for (const target of viableTargets) {
      let success;
      if (target.targetMode === "prep") {
        if (target.needsWeaken) {
          success = assignWeaken(ns, target, workers);
          if (!success) {
            ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
            await ns.sleep(1e4);
          }
        } else if (target.needsGrow) {
          success = assignGrow(ns, target, workers, target.stockImpact === "bull");
          if (!success) {
            ns.print(`${RED}⚠️ assignGrow() returned an error${RESET}`);
            await ns.sleep(1e4);
          }
        }
      } else if (target.targetMode === "farm") {
        success = assignWeaken(ns, target, workers);
        if (!success) {
          ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
          await ns.sleep(1e4);
        }
        success = assignGrow(ns, target, workers, target.stockImpact === "bull");
        if (!success) {
          ns.print(`${RED}⚠️ assignGrow() returned an error${RESET}`);
          await ns.sleep(1e4);
        }
        success = assignWeaken(ns, target, workers);
        if (!success) {
          ns.print(`${RED}⚠️ assignWeaken() returned an error${RESET}`);
          await ns.sleep(1e4);
        }
        success = assignHack(ns, target, workers, target.stockImpact === "bear");
        if (!success) {
          ns.print(`${RED}⚠️ assignHack() returned an error${RESET}`);
          await ns.sleep(1e4);
        }
      } else {
        ns.print(`${YELLOW}⚠️ ${target.targetMode} is an invalid target mode for ${target.name}${RESET}`);
      }
    }
    await ns.sleep(1e3);
  }
}