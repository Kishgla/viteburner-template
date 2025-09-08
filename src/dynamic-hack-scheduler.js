/** @param {NS} ns */
import {
  getAllServerNames,
  getServerObjects,
  updateTargetFlags,
  refreshServers,
  countAvailablePortOpeners,
  runAvailablePortOpeners
} from "./helpers.js";

/*******************************************************************************\
|* Config                                                                      *|
\*******************************************************************************/

const WEAKEN = "weaken.js";
const GROW   = "grow.js";
const HACK   = "hack.js";

const SECURITY_BUFFER    = 5;     // how close to min-sec before we say "prepped"
const FUNDING_THRESHOLD  = 0.95;  // how close to moneyMax before we say "funded"

// Batch timing
const STEP_PAD     = 120;   // ms padding between steps within the same batch
const CHAIN_SPACER = 200;   // ms spacing between *landing times* of consecutive batches on same target
const PIPELINE     = 6;     // how many overlapping batches we try to keep in-flight per target

// Batch sizing
const STEAL_FRAC   = 0.08;  // steal ~8% per batch – stable and RAM friendly
const HOME_RAM_FRACTION = 0.80; // cap how much of home we use

// ANSI Colors for tprint
const RED    = "\u001b[31m";
const YELLOW = "\u001b[33m";
const RESET  = "\u001b[0m";

/*******************************************************************************\
|* Small utilities                                                             *|
\*******************************************************************************/

function sortWorkers(workers) {
  return [...workers].sort((a, b) => (b.data.maxRam - b.data.ramUsed) - (a.data.maxRam - a.data.ramUsed));
}

function times(ns, target) {
  return {
    h: ns.getHackTime(target),
    g: ns.getGrowTime(target),
    w: ns.getWeakenTime(target),
  };
}

const SCRIPT_LIST = [WEAKEN, GROW, HACK];
function ensureScripts(ns, host) {
  const missing = SCRIPT_LIST.filter(s => !ns.fileExists(s, host));
  if (missing.length) {
    const ok = ns.scp(missing, host, "home");
    if (!ok) {
      ns.tprint(`${RED}⚠️ Failed to copy ${missing.join(", ")} to ${host}${RESET}`);
      return false;
    } 
  }
  return true;
}

function freeRam(ns, host) {
  const s = ns.getServer(host);
  const cap = (host === "home") ? s.maxRam * HOME_RAM_FRACTION : s.maxRam;
  return Math.max(0, cap - s.ramUsed);
}

/** Spread threads across workers, scheduling a job to END at latestEnd.
 * args is an array of base args (we append the delay at the end).
 */
function dispatchToEnd(ns, file, args, workers, totalThreads, actionTime, latestEnd) {
  if (totalThreads <= 0) return 0;
  workers = sortWorkers(workers);
  const ramPerThread = ns.getScriptRam(file, "home");
  let remaining = totalThreads;
  for (const w of workers) {
    if (!ensureScripts(ns, w.name)) continue;
    const availThreads = Math.floor(freeRam(ns, w.name) / ramPerThread);
    if (availThreads <= 0) continue;
    const useThreads = Math.min(availThreads, remaining);
    const delay = Math.max(0, Math.floor(latestEnd - actionTime - Date.now()));

    // Launch with appended delay arg
    const pid = ns.exec(file, w.name, useThreads, ...args, delay);
    if (pid !== 0) {
      remaining -= useThreads;
      if (remaining <= 0) break;
    }
  }
  return totalThreads - remaining; // launched threads
}

/** Calculate batch threads for a self-contained HWGW batch.
 * We compute hack threads to steal ~stealFrac of CURRENT money,
 * grow threads to restore to max, and two weaken sets to cover sec.
 */
function calcBatch(ns, target, stealFrac = STEAL_FRAC) {
  const name = target.name ?? target; // accepts string or your server obj
  const s = ns.getServer(name);
  const cur = Math.max(1, s.moneyAvailable);
  const max = Math.max(1, s.moneyMax);

  // Hack
  const stealAmt = Math.max(1, Math.floor(cur * Math.min(0.99, Math.max(0.001, stealFrac))));
  let hackT = Math.floor(ns.hackAnalyzeThreads(name, stealAmt));
  if (!isFinite(hackT) || hackT < 1) hackT = 1;

  // Estimate post-hack money
  const hackPct = ns.hackAnalyze(name); // fraction per thread of CURRENT money
  const afterHack = Math.max(1, cur - Math.floor(cur * hackPct * hackT));

  // Grow back to max from post-hack
  const growMult = Math.max(1, max / afterHack);
  let growT = Math.ceil(ns.growthAnalyze(name, growMult));
  if (!isFinite(growT) || growT < 1) growT = 1;

  // Security effects (Bitburner defaults)
  const secFromHack = hackT * 0.002;
  const secFromGrow = growT * 0.004;
  const weakenPerThread = 0.05;

  const w1 = Math.ceil(secFromHack / weakenPerThread);
  const w2 = Math.ceil(secFromGrow / weakenPerThread);

  return { hackT, growT, w1, w2, cur, max };
}

function tryGainRootAccess(ns, target) {
  if (target.data.hasAdminRights) return true;
  const availablePortOpeners = countAvailablePortOpeners(ns);
  if (availablePortOpeners >= target.data.numOpenPortsRequired) {
    runAvailablePortOpeners(ns, target.name);

    try {
      ns.nuke(target.name);
      ns.tprint(`🌐 Gained root on ${target.name}`);
    } catch (e) {
      ns.tprint(`${YELLOW}⚠️ Failed to nuke ${target.name}${RESET}`);
      ns.tprint(`${RED}   Error: ${e}${RESET}`);
      return false;
    }
  }

  return ns.hasRootAccess(target.name);
}

/** Check if target is "prepped enough" for batching */
function isPrepped(ns, target) {
  const s = ns.getServer(target.name);
  const secGood = s.hackDifficulty <= s.minDifficulty + SECURITY_BUFFER;
  const moneyGood = s.moneyAvailable >= s.moneyMax * FUNDING_THRESHOLD;
  return secGood && moneyGood;
}

/** Prep step: weaken down OR grow+weaken up, with immediate landing (no overlap logic needed) */
function runPrepStep(ns, target, workers) {
  const name = target.name;
  const s = ns.getServer(name);
  const { g, w } = times(ns, name);

  if (s.hackDifficulty > s.minDifficulty + SECURITY_BUFFER) {
    const weakenNeeded = Math.ceil((s.hackDifficulty - s.minDifficulty) / 0.05);
    const end = Date.now() + w + STEP_PAD;
    const used = dispatchToEnd(ns, WEAKEN, [name], workers, weakenNeeded, w, end);
    return used > 0;
  }

  if (s.moneyAvailable < s.moneyMax * FUNDING_THRESHOLD) {
    // grow to max and cover security
    const growMult = Math.max(1, s.moneyMax / Math.max(1, s.moneyAvailable));
    const growT = Math.max(1, Math.ceil(ns.growthAnalyze(name, growMult)));
    const w2 = Math.ceil((growT * 0.004) / 0.05);

    const end = Date.now() + w + STEP_PAD;
    const usedW = dispatchToEnd(ns, WEAKEN, [name], workers, w2, w, end);
    const usedG = dispatchToEnd(ns, GROW, [name, false], workers, growT, g, end - STEP_PAD);
    return (usedW + usedG) > 0;
  }

  return false;
}

/** Schedule a single HWGW batch to LAND together at latestEnd (with STEP_PAD staggers) */
function scheduleBatch(ns, targetName, workers, stealFrac, latestEnd) {
  const { h, g, w } = times(ns, targetName);
  const { hackT, growT, w1, w2 } = calcBatch(ns, targetName, stealFrac);

  // Landing order: W2 -> G -> W1 -> H
  let ok = false;
  ok = dispatchToEnd(ns, WEAKEN, [targetName], workers, w2, w, latestEnd) > 0 || ok;
  ok = dispatchToEnd(ns, GROW,   [targetName, false], workers, growT, g, latestEnd - STEP_PAD) > 0 || ok;
  ok = dispatchToEnd(ns, WEAKEN, [targetName], workers, w1, w, latestEnd - 2 * STEP_PAD) > 0 || ok;
  ok = dispatchToEnd(ns, HACK,   [targetName, false], workers, hackT, h, latestEnd - 3 * STEP_PAD) > 0 || ok;

  return ok;
}

/** Attempt to keep up to PIPELINE batches in-flight for target.
 * We *project* stable state by making each batch self-contained (restore & re-weaken),
 * which allows safe overlap with only a CHAIN_SPACER between batch landings.
 */
function fillPipeline(ns, targetName, workers, stealFrac) {
  const landBase = Date.now();
  // Try to schedule up to PIPELINE batches, spaced by CHAIN_SPACER
  let scheduled = 0;
  const { w } = times(ns, targetName);
  // choose first latestEnd far enough out to reliably schedule
  let latestEnd = Date.now() + w + 3 * STEP_PAD;

  for (let i = 0; i < PIPELINE; i++) {
    const ok = scheduleBatch(ns, targetName, workers, stealFrac, latestEnd);
    if (!ok) break;
    scheduled++;
    latestEnd += CHAIN_SPACER;
  }
  return scheduled;
}

/*******************************************************************************\
|* Main Loop                                                                   *|
\*******************************************************************************/
export async function main(ns) {
  ns.disableLog("sleep");
  ns.disableLog("getServerUsedRam");
  ns.disableLog("scp");

  while (true) {
    // Discover everything and root if possible
    const serverNames = getAllServerNames(ns);
    const serverObjects = getServerObjects(ns, serverNames, SECURITY_BUFFER, FUNDING_THRESHOLD);
    const hackingLevel = ns.getHackingLevel();

    for (const t of serverObjects) {
      tryGainRootAccess(ns, t);
    }

    // Workers = all rooted servers with RAM
    const workers = serverObjects.filter(s => s.data.hasAdminRights && s.data.maxRam > 0);
    for (const w of workers) {
      ensureScripts(ns, w.name);
    }

    // Targets we can hack
    const viableTargets = serverObjects.filter(s =>
      s.data.hasAdminRights &&
      s.data.moneyMax > 0 &&
      s.data.requiredHackingSkill <= hackingLevel
    );

    // Refresh your metadata (does not alter our pipeline logic)
    refreshServers(ns, viableTargets);
    updateTargetFlags(viableTargets, SECURITY_BUFFER, FUNDING_THRESHOLD);

    // Rank targets (simple baseline). You can swap in formulas later.
    viableTargets.sort((a, b) => {
      const scoreA = a.maxMoney / Math.max(1, a.minSecurity);
      const scoreB = b.maxMoney / Math.max(1, b.minSecurity);
      return scoreB - scoreA;
    });

    // Drive each target: prep if needed, otherwise fill pipeline
    for (const target of viableTargets) {
      if (!isPrepped(ns, target)) {
        runPrepStep(ns, target, workers);
        continue;
      }
      // Target prepped → keep batches flowing
      fillPipeline(ns, target.name, workers, STEAL_FRAC);
    }

    await ns.sleep(250); // tight loop; we’re using delays for timing
  }
}