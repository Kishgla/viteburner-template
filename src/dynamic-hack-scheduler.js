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
|* Stock Influence Integration                                                 *|
\*******************************************************************************/

function getStockInfluence(ns, targetName) {
  try {
    // Map server names to stock symbols (you'll need to customize this mapping)
    const serverToStock = {
      "foodnstuff": "FNS",
      "sigma-cosmetics": "SGC",
      "joesguns": "JGN",
      "nectar-net": "NWTR",
      "hong-fang-tea": "HFT",
      "harakiri-sushi": "HRKS",
      // Add more mappings as needed
    };

    const stockSymbol = serverToStock[targetName];
    if (!stockSymbol) return null;

    const influenceFile = `/stock-influence/${stockSymbol}.txt`;
    if (!ns.fileExists(influenceFile)) return null;

    const content = ns.read(influenceFile);
    if (!content) return null;

    const instructions = JSON.parse(content);
    const age = Date.now() - instructions.timestamp;

    // Instructions expire after 5 minutes
    if (age > 300000) return null;

    return instructions.direction; // 'up' or 'down'
  } catch (e) {
    return null;
  }
}

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

let idSequence = 0;

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

/** Create a process-unique ID. The sequence prevents collisions within one tick. */
function createJobId(ns, kind, targetName) {
  idSequence += 1;
  const safeTarget = targetName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${kind}-${safeTarget}-${Date.now().toString(36)}-${ns.pid}-${idSequence}`;
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

/** Spread threads across workers, scheduling a job to END at latestEnd. */
function dispatchToEnd(ns, file, targetName, stock, batchId, workers, totalThreads, actionTime, latestEnd) {
  const launches = [];
  if (totalThreads <= 0) return { threads: 0, launches };
  workers = sortWorkers(workers);
  const ramPerThread = ns.getScriptRam(file, "home");
  let remaining = totalThreads;

  // Get stock influence direction
  const influence = getStockInfluence(ns, targetName);

  for (const w of workers) {
    if (!ensureScripts(ns, w.name)) continue;
    const availThreads = Math.floor(freeRam(ns, w.name) / ramPerThread);
    if (availThreads <= 0) continue;
    const useThreads = Math.min(availThreads, remaining);
    const delay = Math.max(0, Math.floor(latestEnd - actionTime - Date.now()));

    // Modify args based on stock influence
    let stockFlag = stock;

    if (file === HACK || file === GROW) {
      // Determine stock influence flag based on desired direction and action
      stockFlag = false; // Default: no influence on stock

      if (influence === "up") {
        // Want stock to go up
        stockFlag = (file === GROW); // Grow increases stock, hack decreases it
      } else if (influence === "down") {
        // Want stock to go down  
        stockFlag = (file === HACK); // Hack decreases stock, grow increases it
      }

    }

    // batchId is part of the process signature, so otherwise-identical jobs can coexist.
    const pid = ns.exec(file, w.name, useThreads, targetName, stockFlag, delay, batchId);
    if (pid !== 0) {
      remaining -= useThreads;
      launches.push({ pid, host: w.name, file, threads: useThreads });
      if (remaining <= 0) break;
    }
  }
  return { threads: totalThreads - remaining, launches };
}

function operationName(file) {
  if (file === HACK) return "hack";
  if (file === GROW) return "grow";
  return "weaken";
}

function recordLaunches(operations, file, result) {
  for (const launch of result.launches) {
    operations.push({ ...launch, operation: operationName(file) });
  }
}

function batchCreatedAt(batchId, fallback) {
  const match = batchId.match(/-([0-9a-z]+)-\d+-\d+$/);
  if (!match) return fallback;
  const timestamp = parseInt(match[1], 36);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

/**
 * Reconstructed landing times can be a few milliseconds early because batch IDs
 * are created just before the worker delays are calculated. Preserve the known
 * scheduler invariant when rebuilding state after a restart.
 */
function normalizeRecoveredLandings(trackedBatches) {
  const batchesByTarget = new Map();
  for (const batch of trackedBatches.values()) {
    if (!batch.recovered || batch.operations.length === 0) continue;
    const batches = batchesByTarget.get(batch.target) ?? [];
    batches.push(batch);
    batchesByTarget.set(batch.target, batches);
  }

  for (const batches of batchesByTarget.values()) {
    batches.sort((a, b) => a.expectedLanding - b.expectedLanding || a.id.localeCompare(b.id));
    for (let i = 1; i < batches.length; i++) {
      batches[i].expectedLanding = Math.max(
        batches[i].expectedLanding,
        batches[i - 1].expectedLanding + CHAIN_SPACER,
      );
    }
  }
}

/** Reconcile tracked state with worker process tables, including after a restart. */
function reconcileBatches(ns, trackedBatches, workers) {
  const now = Date.now();
  const liveBatches = new Map();

  for (const worker of workers) {
    for (const process of ns.ps(worker.name)) {
      if (!SCRIPT_LIST.includes(process.filename)) continue;
      const batchId = String(process.args[3] ?? "");
      if (!batchId.startsWith("batch-")) continue;

      const target = String(process.args[0] ?? "");
      const delay = Math.max(0, Number(process.args[2]) || 0);
      const createdAt = batchCreatedAt(batchId, now);
      const actionTime = process.filename === HACK
        ? ns.getHackTime(target)
        : process.filename === GROW
          ? ns.getGrowTime(target)
          : ns.getWeakenTime(target);
      const operation = {
        pid: process.pid,
        host: worker.name,
        file: process.filename,
        threads: process.threads,
        operation: operationName(process.filename),
      };

      if (!liveBatches.has(batchId)) {
        liveBatches.set(batchId, {
          id: batchId,
          target,
          expectedLanding: createdAt + delay + actionTime,
          operations: [],
          recovered: true,
        });
      }
      const batch = liveBatches.get(batchId);
      batch.expectedLanding = Math.max(batch.expectedLanding, createdAt + delay + actionTime);
      batch.operations.push(operation);
    }
  }

  for (const [batchId, batch] of trackedBatches) {
    const live = liveBatches.get(batchId);
    if (live) {
      batch.operations = live.operations;
      if (batch.recovered) batch.expectedLanding = live.expectedLanding;
      liveBatches.delete(batchId);
    } else {
      // No matching PID remains, so the record is complete, killed, or otherwise stale.
      trackedBatches.delete(batchId);
    }
  }

  for (const [batchId, batch] of liveBatches) trackedBatches.set(batchId, batch);
  normalizeRecoveredLandings(trackedBatches);
}

function activeBatchesForTarget(trackedBatches, targetName) {
  const batches = [];
  for (const batch of trackedBatches.values()) {
    if (batch.target === targetName && batch.operations.length > 0) batches.push(batch);
  }
  return batches;
}

function publishTrackingSnapshot(ns, trackedBatches, port) {
  if (port === null) return;
  const snapshot = {
    schedulerPid: ns.pid,
    timestamp: Date.now(),
    batches: [...trackedBatches.values()],
  };
  ns.clearPort(port);
  ns.writePort(port, JSON.stringify(snapshot));
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
    const prepId = createJobId(ns, "prep-weaken", name);
    const weakenNeeded = Math.ceil((s.hackDifficulty - s.minDifficulty) / 0.05);
    const end = Date.now() + w + STEP_PAD;
    const used = dispatchToEnd(ns, WEAKEN, name, false, prepId, workers, weakenNeeded, w, end);
    return used.threads > 0;
  }

  if (s.moneyAvailable < s.moneyMax * FUNDING_THRESHOLD) {
    const prepId = createJobId(ns, "prep-grow", name);
    // grow to max and cover security
    const growMult = Math.max(1, s.moneyMax / Math.max(1, s.moneyAvailable));
    const growT = Math.max(1, Math.ceil(ns.growthAnalyze(name, growMult)));
    const w2 = Math.ceil((growT * 0.004) / 0.05);

    const end = Date.now() + w + STEP_PAD;
    const usedW = dispatchToEnd(ns, WEAKEN, name, false, prepId, workers, w2, w, end);
    const usedG = dispatchToEnd(ns, GROW, name, false, prepId, workers, growT, g, end - STEP_PAD);
    return (usedW.threads + usedG.threads) > 0;
  }

  return false;
}

/** Schedule a single HWGW batch to LAND together at latestEnd (with STEP_PAD staggers) */
function scheduleBatch(ns, targetName, workers, stealFrac, latestEnd, batchId) {
  const { h, g, w } = times(ns, targetName);
  const { hackT, growT, w1, w2 } = calcBatch(ns, targetName, stealFrac);

  // Landing order: W2 -> G -> W1 -> H
  const operations = [];
  recordLaunches(operations, WEAKEN, dispatchToEnd(ns, WEAKEN, targetName, false, batchId, workers, w2, w, latestEnd));
  recordLaunches(operations, GROW, dispatchToEnd(ns, GROW, targetName, false, batchId, workers, growT, g, latestEnd - STEP_PAD));
  recordLaunches(operations, WEAKEN, dispatchToEnd(ns, WEAKEN, targetName, false, batchId, workers, w1, w, latestEnd - 2 * STEP_PAD));
  recordLaunches(operations, HACK, dispatchToEnd(ns, HACK, targetName, false, batchId, workers, hackT, h, latestEnd - 3 * STEP_PAD));

  if (operations.length === 0) return null;
  return { id: batchId, target: targetName, expectedLanding: latestEnd, operations, recovered: false };
}

/** Attempt to keep up to PIPELINE batches in-flight for target.
 * We *project* stable state by making each batch self-contained (restore & re-weaken),
 * which allows safe overlap with only a CHAIN_SPACER between batch landings.
 */
function fillPipeline(ns, targetName, workers, stealFrac, trackedBatches, nextLandingByTarget) {
  const activeBatches = activeBatchesForTarget(trackedBatches, targetName);
  const openSlots = Math.max(0, PIPELINE - activeBatches.length);
  if (openSlots === 0) return 0;

  let scheduled = 0;
  const { w } = times(ns, targetName);
  const earliestLanding = Date.now() + w + 3 * STEP_PAD;
  const latestActiveLanding = activeBatches.reduce(
    (latest, batch) => Math.max(latest, batch.expectedLanding),
    0,
  );
  // The cursor survives loop iterations. The active-batch fallback reconstructs
  // safe spacing when the scheduler starts while workers are already running.
  let latestEnd = Math.max(
    earliestLanding,
    nextLandingByTarget.get(targetName) ?? 0,
    latestActiveLanding > 0 ? latestActiveLanding + CHAIN_SPACER : 0,
  );

  for (let i = 0; i < openSlots; i++) {
    const batchId = createJobId(ns, "batch", targetName);
    const batch = scheduleBatch(ns, targetName, workers, stealFrac, latestEnd, batchId);
    if (!batch) break;
    trackedBatches.set(batchId, batch);
    scheduled++;
    latestEnd += CHAIN_SPACER;
    nextLandingByTarget.set(targetName, latestEnd);
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

  const requestedPort = Number(ns.args[0]);
  const trackingPort = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 20
    ? requestedPort
    : null;

  // This registry intentionally lives outside the loop so state persists between iterations.
  const trackedBatches = new Map();
  const nextLandingByTarget = new Map();

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
    reconcileBatches(ns, trackedBatches, workers);

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
      // Target prepped → refill only the open slots in its independent pipeline.
      fillPipeline(ns, target.name, workers, STEAL_FRAC, trackedBatches, nextLandingByTarget);
    }

    publishTrackingSnapshot(ns, trackedBatches, trackingPort);

    await ns.sleep(250); // tight loop; we’re using delays for timing
  }
}
