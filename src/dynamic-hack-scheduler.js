/** @param {NS} ns */
import {
  getAllServerNames,
  getServerObjects,
  updateTargetFlags,
  refreshServers,
  countAvailablePortOpeners,
  runAvailablePortOpeners,
} from './helpers.js';

/*******************************************************************************\
|* Stock Influence Integration                                                 *|
\*******************************************************************************/

function getStockInfluence(ns, targetName) {
  try {
    // Map server names to stock symbols (you'll need to customize this mapping)
    const serverToStock = {
      foodnstuff: 'FNS',
      'sigma-cosmetics': 'SGC',
      joesguns: 'JGN',
      'nectar-net': 'NWTR',
      'hong-fang-tea': 'HFT',
      'harakiri-sushi': 'HRKS',
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

const WEAKEN = 'weaken.js';
const GROW = 'grow.js';
const HACK = 'hack.js';
// Increment whenever a deployed scheduler must replace an already-running copy.
const SINGLETON_VERSION = 8;
const VERSION_ARG = '--scheduler-version=';
const EXEC_FAILURE_ARG = '--test-fail-exec-after=';
const STATUS_INTERVAL_ARG = '--status-interval=';
const EVENT_ONLY_ARG = '--event-only';
const XP_ARG = '--xp';
const DEFAULT_STATUS_INTERVAL = 2_000;
const MIN_STATUS_INTERVAL = 250;
const XP_JOB_PREFIX = 'xp-joesguns-';
const XP_TARGET = 'joesguns';

const SECURITY_BUFFER = 5; // how close to min-sec before we say "prepped"
const FUNDING_THRESHOLD = 0.95; // how close to moneyMax before we say "funded"

// Batch timing
const STEP_PAD = 120; // ms padding between steps within the same batch
const CHAIN_SPACER = 200; // ms spacing between *landing times* of consecutive batches on same target
const PIPELINE = 6; // how many overlapping batches we try to keep in-flight per target

// Batch sizing
const STEAL_FRAC = 0.08; // steal ~8% per batch – stable and RAM friendly
const HOME_RAM_FRACTION = 0.8; // cap how much of home we use

// ANSI Colors for tprint
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

let idSequence = 0;

/*******************************************************************************\
|* Small utilities                                                             *|
\*******************************************************************************/

function sortWorkers(workers) {
  return [...workers].sort((a, b) => b.data.maxRam - b.data.ramUsed - (a.data.maxRam - a.data.ramUsed));
}

function schedulerVersion(args) {
  const marker = args.find((arg) => String(arg).startsWith(VERSION_ARG));
  if (marker === undefined) return 0;
  const version = Number(String(marker).slice(VERSION_ARG.length));
  return Number.isInteger(version) ? version : 0;
}

/**
 * Bootstrap a version-tagged singleton and replace incompatible owners without
 * touching their worker processes. Returns true only for the persistent owner.
 */
function claimSchedulerSingleton(ns) {
  const scriptName = ns.getScriptName();
  const currentVersion = schedulerVersion(ns.args);
  const schedulers = getAllServerNames(ns, false).flatMap((host) =>
    ns
      .ps(host)
      .filter((process) => process.filename === scriptName && process.pid !== ns.pid)
      .map((process) => ({ host, ...process, version: schedulerVersion(process.args) })),
  );

  if (currentVersion === 0) {
    const newerOwner = schedulers.find((process) => process.version > SINGLETON_VERSION);
    if (newerOwner) {
      ns.tprint(`${scriptName}: newer scheduler v${newerOwner.version} is already running as PID ${newerOwner.pid}.`);
      return false;
    }

    const currentOwner = schedulers.find((process) => process.version === SINGLETON_VERSION);
    if (currentOwner) {
      ns.tprint(`${scriptName}: scheduler v${SINGLETON_VERSION} is already running as PID ${currentOwner.pid}.`);
      return false;
    }

    let replaced = 0;
    for (const process of schedulers.filter((candidate) => candidate.version < SINGLETON_VERSION)) {
      if (ns.kill(process.pid, process.host)) replaced += 1;
    }
    if (replaced > 0) {
      ns.tprint(`${scriptName}: replaced ${replaced} older scheduler instance${replaced === 1 ? '' : 's'}.`);
    }

    // spawn frees this launcher's RAM before starting the persistent, tagged owner.
    ns.spawn(scriptName, 1, ...ns.args, `${VERSION_ARG}${SINGLETON_VERSION}`);
    return false;
  }

  const newerOwner = schedulers.find((process) => process.version > currentVersion);
  if (newerOwner) return false;

  for (const process of schedulers) {
    if (process.version < currentVersion) ns.kill(process.pid, process.host);
  }

  const sameVersionOwners = schedulers.filter((process) => process.version === currentVersion);
  if (sameVersionOwners.some((process) => process.pid < ns.pid)) return false;
  for (const process of sameVersionOwners) ns.kill(process.pid, process.host);
  return true;
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
  const safeTarget = targetName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${kind}-${safeTarget}-${Date.now().toString(36)}-${ns.pid}-${idSequence}`;
}

const SCRIPT_LIST = [WEAKEN, GROW, HACK];
function ensureScripts(ns, host) {
  const missing = SCRIPT_LIST.filter((s) => !ns.fileExists(s, host));
  if (missing.length) {
    const ok = ns.scp(missing, host, 'home');
    if (!ok) {
      ns.tprint(`${RED}⚠️ Failed to copy ${missing.join(', ')} to ${host}${RESET}`);
      return false;
    }
  }
  return true;
}

function freeRam(ns, host) {
  const s = ns.getServer(host);
  const cap = host === 'home' ? s.maxRam * HOME_RAM_FRACTION : s.maxRam;
  return Math.max(0, cap - s.ramUsed);
}

/** Reserve worker RAM for every operation before any part of a batch is launched. */
function planBatchDispatch(ns, workers, operationSpecs) {
  const sortedWorkers = sortWorkers(workers);
  const remainingRam = new Map(sortedWorkers.map((worker) => [worker.name, freeRam(ns, worker.name)]));
  const allocations = [];

  for (const spec of operationSpecs) {
    const ramPerThread = ns.getScriptRam(spec.file, 'home');
    let remainingThreads = spec.threads;
    const workerAllocations = [];

    for (const worker of sortedWorkers) {
      const availableRam = remainingRam.get(worker.name) ?? 0;
      const availableThreads = Math.floor(availableRam / ramPerThread);
      if (availableThreads <= 0) continue;
      const threads = Math.min(availableThreads, remainingThreads);
      workerAllocations.push({ host: worker.name, threads });
      remainingRam.set(worker.name, availableRam - threads * ramPerThread);
      remainingThreads -= threads;
      if (remainingThreads === 0) break;
    }

    if (remainingThreads > 0) {
      return { complete: false, allocations: [], missing: { phase: spec.phase, threads: remainingThreads } };
    }
    allocations.push({ ...spec, workers: workerAllocations });
  }

  return { complete: true, allocations, missing: null };
}

function configuredExecFailure(ns) {
  const marker = ns.args.find((arg) => String(arg).startsWith(EXEC_FAILURE_ARG));
  if (marker === undefined) return null;
  const count = Number(String(marker).slice(EXEC_FAILURE_ARG.length));
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function statusOptions(args) {
  const eventOnly = args.some((arg) => String(arg) === EVENT_ONLY_ARG);
  const markers = args.filter((arg) => String(arg).startsWith(STATUS_INTERVAL_ARG));
  if (markers.length > 1) return { valid: false, error: `${STATUS_INTERVAL_ARG} may only be supplied once.` };
  if (markers.length === 0) return { valid: true, eventOnly, interval: DEFAULT_STATUS_INTERVAL };
  const interval = Number(String(markers[0]).slice(STATUS_INTERVAL_ARG.length));
  if (!Number.isFinite(interval) || !Number.isInteger(interval) || interval < MIN_STATUS_INTERVAL) {
    return {
      valid: false,
      error: `${STATUS_INTERVAL_ARG} must be an integer of at least ${MIN_STATUS_INTERVAL} milliseconds.`,
    };
  }
  return { valid: true, eventOnly, interval };
}

function xpProcesses(ns, workers) {
  return workers.flatMap((worker) =>
    ns
      .ps(worker.name)
      .filter((process) => process.filename === GROW && String(process.args[3] ?? '').startsWith(XP_JOB_PREFIX))
      .map((process) => ({ host: worker.name, ...process })),
  );
}

function reclaimXpRam(ns, workers) {
  let killed = 0;
  for (const process of xpProcesses(ns, workers)) {
    if (ns.kill(process.pid, process.host)) killed += 1;
  }
  return killed;
}

function schedulerNeedsRam(ns, viableTargets, trackedBatches, trackedPreps) {
  for (const target of viableTargets) {
    const batches = activeBatchesForTarget(trackedBatches, target.name);
    const prep = activePrepForTarget(trackedPreps, target.name);
    if (!isPrepped(ns, target)) {
      if (batches.length === 0 && prep === null) return true;
    } else if (prep === null && batches.length < PIPELINE) {
      return true;
    }
  }
  return false;
}

function fillXpRam(ns, workers, enabled) {
  if (!enabled || !ns.hasRootAccess(XP_TARGET)) return 0;
  const ramPerThread = ns.getScriptRam(GROW, 'home');
  if (ramPerThread <= 0) return 0;
  let launched = 0;
  for (const worker of workers) {
    const threads = Math.floor(freeRam(ns, worker.name) / ramPerThread);
    if (threads <= 0) continue;
    const id = `${XP_JOB_PREFIX}${Date.now().toString(36)}-${worker.name}-${idSequence++}`;
    const pid = ns.exec(GROW, worker.name, threads, XP_TARGET, false, 0, id);
    if (pid !== 0) launched += 1;
  }
  return launched;
}

function launchBatchPlan(ns, targetName, batchId, plan) {
  const operations = [];
  const influence = getStockInfluence(ns, targetName);
  const failAfter = configuredExecFailure(ns);

  for (const allocation of plan.allocations) {
    const delay = Math.max(0, Math.floor(allocation.end - allocation.actionTime - Date.now()));
    let stock = false;
    if (influence === 'up') stock = allocation.file === GROW;
    if (influence === 'down') stock = allocation.file === HACK;

    for (const worker of allocation.workers) {
      const injectFailure = failAfter !== null && operations.length >= failAfter;
      const pid = injectFailure
        ? 0
        : ns.exec(allocation.file, worker.host, worker.threads, targetName, stock, delay, batchId);
      if (pid === 0) {
        // RAM can change between planning and exec. Roll back prior launches so an
        // unexpected race does not deliberately leave an incomplete HWGW batch.
        for (const operation of operations) ns.kill(operation.pid, operation.host);
        const survivors = operations.filter((operation) => ns.isRunning(operation.pid, operation.host));
        return { status: survivors.length > 0 ? 'partial' : 'failed', operations: survivors };
      }
      operations.push({
        pid,
        host: worker.host,
        file: allocation.file,
        threads: worker.threads,
        operation: operationName(allocation.file),
        phase: allocation.phase,
      });
    }
  }

  return { status: 'complete', operations };
}

function operationName(file) {
  if (file === HACK) return 'hack';
  if (file === GROW) return 'grow';
  return 'weaken';
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
      batches[i].expectedLanding = Math.max(batches[i].expectedLanding, batches[i - 1].expectedLanding + CHAIN_SPACER);
    }
  }
}

/** Reconcile tracked state with worker process tables, including after a restart. */
function reconcileBatches(ns, trackedBatches, workers) {
  const now = Date.now();
  const liveBatches = new Map();

  // A partial record means the immediate rollback could not kill every launch.
  // Retry cleanup before rebuilding the live process view and never refill it.
  for (const batch of trackedBatches.values()) {
    if (batch.dispatchStatus !== 'partial') continue;
    for (const operation of batch.operations) ns.kill(operation.pid, operation.host);
  }

  for (const worker of workers) {
    for (const process of ns.ps(worker.name)) {
      if (!SCRIPT_LIST.includes(process.filename)) continue;
      const batchId = String(process.args[3] ?? '');
      if (!batchId.startsWith('batch-')) continue;

      const target = String(process.args[0] ?? '');
      const delay = Math.max(0, Number(process.args[2]) || 0);
      const createdAt = batchCreatedAt(batchId, now);
      const actionTime =
        process.filename === HACK
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

/** Rebuild prep ownership from the process table so restarts cannot duplicate prep work. */
function reconcilePreps(ns, trackedPreps, workers) {
  const now = Date.now();
  const livePreps = new Map();
  for (const prep of trackedPreps.values()) {
    if (prep.dispatchStatus !== 'partial') continue;
    for (const operation of prep.operations) ns.kill(operation.pid, operation.host);
  }
  for (const worker of workers) {
    for (const process of ns.ps(worker.name)) {
      const prepId = String(process.args[3] ?? '');
      if (!SCRIPT_LIST.includes(process.filename) || !prepId.startsWith('prep-')) continue;
      const target = String(process.args[0] ?? '');
      const delay = Math.max(0, Number(process.args[2]) || 0);
      const createdAt = batchCreatedAt(prepId, now);
      const actionTime =
        process.filename === GROW
          ? ns.getGrowTime(target)
          : process.filename === HACK
          ? ns.getHackTime(target)
          : ns.getWeakenTime(target);
      const operation = {
        pid: process.pid,
        host: worker.name,
        file: process.filename,
        threads: process.threads,
        operation: operationName(process.filename),
      };
      const prep = livePreps.get(prepId) ?? {
        id: prepId,
        target,
        kind: prepId.startsWith('prep-grow-') ? 'grow' : 'weaken',
        expectedLanding: createdAt + delay + actionTime,
        operations: [],
        recovered: true,
      };
      prep.expectedLanding = Math.max(prep.expectedLanding, createdAt + delay + actionTime);
      prep.operations.push(operation);
      livePreps.set(prepId, prep);
    }
  }
  trackedPreps.clear();
  for (const [prepId, prep] of livePreps) trackedPreps.set(prepId, prep);
}

function activePrepForTarget(trackedPreps, targetName) {
  return [...trackedPreps.values()].find((prep) => prep.target === targetName && prep.operations.length > 0) ?? null;
}

function activeBatchesForTarget(trackedBatches, targetName) {
  const batches = [];
  for (const batch of trackedBatches.values()) {
    if (batch.target === targetName && batch.operations.length > 0) batches.push(batch);
  }
  return batches;
}

function publishTrackingSnapshot(
  ns,
  trackedBatches,
  trackedPreps,
  targetStatuses,
  port,
  dispatchAttempts = [],
  latestFailure = null,
  dashboard = {},
) {
  if (port === null) return;
  const snapshot = {
    schedulerPid: ns.pid,
    schedulerVersion: SINGLETON_VERSION,
    timestamp: Date.now(),
    batches: [...trackedBatches.values()],
    preps: [...trackedPreps.values()],
    targets: targetStatuses,
    dispatchAttempts,
    latestFailure,
    dashboard,
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

/** Plan and launch one complete prep step, then retain it until all workers land. */
function runPrepStep(ns, target, workers) {
  const name = target.name;
  const s = ns.getServer(name);
  const { g, w } = times(ns, name);

  if (s.hackDifficulty > s.minDifficulty + SECURITY_BUFFER) {
    const prepId = createJobId(ns, 'prep-weaken', name);
    const weakenNeeded = Math.ceil((s.hackDifficulty - s.minDifficulty) / 0.05);
    const end = Date.now() + w + STEP_PAD;
    return launchPrep(ns, name, prepId, 'weaken', workers, [
      { phase: 'prep-weaken', file: WEAKEN, threads: weakenNeeded, actionTime: w, end },
    ]);
  }

  if (s.moneyAvailable < s.moneyMax * FUNDING_THRESHOLD) {
    const prepId = createJobId(ns, 'prep-grow', name);
    // grow to max and cover security
    const growMult = Math.max(1, s.moneyMax / Math.max(1, s.moneyAvailable));
    const growT = Math.max(1, Math.ceil(ns.growthAnalyze(name, growMult)));
    const w2 = Math.ceil((growT * 0.004) / 0.05);

    const end = Date.now() + w + STEP_PAD;
    return launchPrep(ns, name, prepId, 'grow', workers, [
      { phase: 'prep-weaken', file: WEAKEN, threads: w2, actionTime: w, end },
      { phase: 'prep-grow', file: GROW, threads: growT, actionTime: g, end: end - STEP_PAD },
    ]);
  }

  return null;
}

function launchPrep(ns, targetName, prepId, kind, workers, specs) {
  const plan = planBatchDispatch(ns, workers, specs);
  if (!plan.complete) {
    return { status: 'failed', prep: null, reason: 'insufficient-ram', missing: plan.missing };
  }
  const launch = launchBatchPlan(ns, targetName, prepId, plan);
  const expectedLanding = specs.reduce((latest, spec) => Math.max(latest, spec.end), 0);
  return {
    status: launch.status,
    reason: launch.status === 'complete' ? null : 'launch-failed',
    prep:
      launch.operations.length === 0
        ? null
        : {
            id: prepId,
            target: targetName,
            kind,
            expectedLanding,
            operations: launch.operations,
            threadAllocation: plan.allocations.map(({ phase, file, threads, workers: allocation }) => ({
              phase,
              file,
              threads,
              workers: allocation,
            })),
            dispatchStatus: launch.status,
            recovered: false,
          },
  };
}

/** Schedule a single HWGW batch to LAND together at latestEnd (with STEP_PAD staggers) */
function scheduleBatch(ns, targetName, workers, stealFrac, latestEnd, batchId) {
  const { h, g, w } = times(ns, targetName);
  const { hackT, growT, w1, w2 } = calcBatch(ns, targetName, stealFrac);

  const specs = [
    { phase: 'weaken-grow', file: WEAKEN, threads: w2, actionTime: w, end: latestEnd },
    { phase: 'grow', file: GROW, threads: growT, actionTime: g, end: latestEnd - STEP_PAD },
    { phase: 'weaken-hack', file: WEAKEN, threads: w1, actionTime: w, end: latestEnd - 2 * STEP_PAD },
    { phase: 'hack', file: HACK, threads: hackT, actionTime: h, end: latestEnd - 3 * STEP_PAD },
  ];
  const plan = planBatchDispatch(ns, workers, specs);
  if (!plan.complete) {
    return {
      status: 'failed',
      batch: null,
      attempt: { id: batchId, target: targetName, status: 'failed', reason: 'insufficient-ram', missing: plan.missing },
    };
  }

  const threadAllocation = plan.allocations.map((allocation) => ({
    phase: allocation.phase,
    file: allocation.file,
    threads: allocation.threads,
    workers: allocation.workers,
  }));
  const launch = launchBatchPlan(ns, targetName, batchId, plan);
  const batch =
    launch.operations.length > 0
      ? {
          id: batchId,
          target: targetName,
          expectedLanding: latestEnd,
          operations: launch.operations,
          threadAllocation,
          dispatchStatus: launch.status,
          recovered: false,
        }
      : null;
  return {
    status: launch.status,
    batch,
    attempt: {
      id: batchId,
      target: targetName,
      status: launch.status,
      reason: launch.status === 'complete' ? null : 'launch-failed',
    },
  };
}

/** Attempt to keep up to PIPELINE batches in-flight for target.
 * We *project* stable state by making each batch self-contained (restore & re-weaken),
 * which allows safe overlap with only a CHAIN_SPACER between batch landings.
 */
function fillPipeline(
  ns,
  targetName,
  workers,
  stealFrac,
  trackedBatches,
  nextLandingByTarget,
  dispatchAttempts,
  operationalState,
) {
  const activeBatches = activeBatchesForTarget(trackedBatches, targetName);
  const openSlots = Math.max(0, PIPELINE - activeBatches.length);
  if (openSlots === 0) return 0;

  let scheduled = 0;
  const { w } = times(ns, targetName);
  const earliestLanding = Date.now() + w + 3 * STEP_PAD;
  const latestActiveLanding = activeBatches.reduce((latest, batch) => Math.max(latest, batch.expectedLanding), 0);
  // The cursor survives loop iterations. The active-batch fallback reconstructs
  // safe spacing when the scheduler starts while workers are already running.
  let latestEnd = Math.max(
    earliestLanding,
    nextLandingByTarget.get(targetName) ?? 0,
    latestActiveLanding > 0 ? latestActiveLanding + CHAIN_SPACER : 0,
  );

  for (let i = 0; i < openSlots; i++) {
    const batchId = createJobId(ns, 'batch', targetName);
    const result = scheduleBatch(ns, targetName, workers, stealFrac, latestEnd, batchId);
    recordAttempt(dispatchAttempts, result.attempt, operationalState);
    if (result.batch) trackedBatches.set(batchId, result.batch);
    if (result.status !== 'complete') break;
    scheduled++;
    latestEnd += CHAIN_SPACER;
    nextLandingByTarget.set(targetName, latestEnd);
  }
  return scheduled;
}

function recordAttempt(dispatchAttempts, attempt, operationalState) {
  const recorded = { ...attempt, timestamp: Date.now() };
  dispatchAttempts.push(recorded);
  if (dispatchAttempts.length > 50) dispatchAttempts.shift();
  if (recorded.status !== 'complete') operationalState.latestFailure = recorded;
}

function formatAllocation(allocations = []) {
  return allocations
    .map(
      (allocation) =>
        `${allocation.phase}:${allocation.threads}[${allocation.workers
          .map((w) => `${w.host}x${w.threads}`)
          .join(',')}]`,
    )
    .join(' ');
}

function logLaunch(ns, kind, job) {
  ns.print(
    `${kind} ${job.id} target=${job.target} landing=${new Date(
      job.expectedLanding,
    ).toLocaleTimeString()} ${formatAllocation(job.threadAllocation)}`,
  );
}

function fitColumn(value, width) {
  const text = String(value ?? '-');
  if (text.length <= width) return text.padEnd(width);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function formatLanding(timestamp) {
  if (!Number.isFinite(timestamp)) return '-';
  return new Date(timestamp).toLocaleTimeString();
}

function boundedFailure(failure, width = 65) {
  if (!failure) return 'Latest failure: none';
  const missing = failure.missing ? ` ${failure.missing.phase}:${failure.missing.threads}` : '';
  const text = `Latest failure: ${failure.target ?? '-'} ${failure.reason ?? failure.status}${missing}`;
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function renderStatus(ns, targetStatuses, trackedBatches, trackedPreps, latestFailure, activeXpWorkers) {
  ns.clearLog();
  const xpThreads = activeXpWorkers.reduce((total, process) => total + process.threads, 0);
  ns.print(
    `Dynamic scheduler v${SINGLETON_VERSION} | batches=${trackedBatches.size} preps=${trackedPreps.size} xp=${activeXpWorkers.length}/${xpThreads}t`,
  );
  ns.print(
    `${fitColumn('TARGET', 20)} ${fitColumn('STATE', 12)} ${fitColumn('PIPE', 6)} ${fitColumn('PREP', 8)} ${fitColumn(
      'NEXT LANDING',
      15,
    )}`,
  );
  for (const status of targetStatuses.slice(0, 20)) {
    ns.print(
      `${fitColumn(status.target, 20)} ${fitColumn(status.state, 12)} ${fitColumn(
        `${status.pipeline}/${PIPELINE}`,
        6,
      )} ${fitColumn(status.prepKind, 8)} ${fitColumn(formatLanding(status.nextLanding), 15)}`,
    );
  }
  ns.print('-'.repeat(65));
  ns.print(boundedFailure(latestFailure));
}

/*******************************************************************************\
|* Main Loop                                                                   *|
\*******************************************************************************/
export async function main(ns) {
  const dashboardOptions = statusOptions(ns.args);
  if (!dashboardOptions.valid) {
    ns.tprint(`${ns.getScriptName()}: ${dashboardOptions.error}`);
    return;
  }
  const xpEnabled = ns.args.some((arg) => String(arg) === XP_ARG);
  if (!claimSchedulerSingleton(ns)) return;

  // The live dashboard owns the tail contents. Netscript API calls otherwise
  // append their own lines immediately after every refresh and displace it.
  ns.disableLog('ALL');

  const requestedPort = Number(ns.args.find((arg) => Number.isInteger(Number(arg))));
  const trackingPort =
    Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 20 ? requestedPort : null;

  // This registry intentionally lives outside the loop so state persists between iterations.
  const trackedBatches = new Map();
  const trackedPreps = new Map();
  const nextLandingByTarget = new Map();
  const dispatchAttempts = [];
  const operationalState = { latestFailure: null };
  const targetOrder = new Map();
  let nextTargetOrder = 0;
  let lastStatusAt = 0;
  let initialRecoveryPass = true;

  while (true) {
    // Discover everything and root if possible
    const serverNames = getAllServerNames(ns, false);
    const serverObjects = getServerObjects(ns, serverNames, SECURITY_BUFFER, FUNDING_THRESHOLD);
    const hackingLevel = ns.getHackingLevel();

    for (const t of serverObjects) {
      tryGainRootAccess(ns, t);
    }

    // Workers = all rooted servers with RAM
    const workers = serverObjects.filter((s) => s.data.hasAdminRights && s.data.maxRam > 0);
    for (const w of workers) {
      ensureScripts(ns, w.name);
    }
    reconcileBatches(ns, trackedBatches, workers);
    reconcilePreps(ns, trackedPreps, workers);

    // Targets we can hack
    const viableTargets = serverObjects.filter(
      (s) => s.data.hasAdminRights && s.data.moneyMax > 0 && s.data.requiredHackingSkill <= hackingLevel,
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

    // XP workers are deliberately preemptible. Remove them before any target
    // needs prep or a pipeline slot so atomic scheduler planning sees the RAM.
    if (!xpEnabled || schedulerNeedsRam(ns, viableTargets, trackedBatches, trackedPreps)) reclaimXpRam(ns, workers);

    const targetStatuses = [];
    // Finish existing batches, prep exactly once, then refill the pipeline.
    for (const target of viableTargets) {
      const activeBatches = activeBatchesForTarget(trackedBatches, target.name);
      const activePrep = activePrepForTarget(trackedPreps, target.name);
      const recoveredWork =
        activeBatches.some((batch) => batch.recovered) || (activePrep !== null && activePrep.recovered);
      // Publish one clean reconstruction snapshot before dispatching anything
      // new for a target inherited from the previous scheduler owner.
      if (initialRecoveryPass && recoveredWork) {
        targetStatuses.push({ target: target.name, state: 'recovering', pipeline: activeBatches.length });
        continue;
      }
      if (!isPrepped(ns, target)) {
        if (activeBatches.length > 0) {
          targetStatuses.push({ target: target.name, state: 'draining', pipeline: activeBatches.length });
          continue;
        }
        if (activePrep) {
          targetStatuses.push({ target: target.name, state: `prep-${activePrep.kind}`, pipeline: 0 });
          continue;
        }
        const result = runPrepStep(ns, target, workers);
        if (result) {
          recordAttempt(
            dispatchAttempts,
            {
              id: result.prep?.id ?? `prep-${target.name}`,
              target: target.name,
              status: result.status,
              reason: result.reason,
              missing: result.missing,
              kind: 'prep',
            },
            operationalState,
          );
          if (result.prep) {
            trackedPreps.set(result.prep.id, result.prep);
            if (dashboardOptions.eventOnly) logLaunch(ns, 'PREP', result.prep);
          }
          if (dashboardOptions.eventOnly && result.status !== 'complete') {
            ns.print(`WARN: prep dispatch for ${target.name} ${result.status}: ${result.reason}`);
          }
        }
        targetStatuses.push({
          target: target.name,
          state: result?.status === 'complete' ? 'prep-new' : 'prep-wait',
          pipeline: 0,
        });
        continue;
      }
      // Do not enter batching until every worker in the last prep step has landed.
      if (activePrep) {
        targetStatuses.push({ target: target.name, state: `prep-${activePrep.kind}`, pipeline: activeBatches.length });
        continue;
      }
      const before = new Set(activeBatches.map((batch) => batch.id));
      fillPipeline(
        ns,
        target.name,
        workers,
        STEAL_FRAC,
        trackedBatches,
        nextLandingByTarget,
        dispatchAttempts,
        operationalState,
      );
      const currentBatches = activeBatchesForTarget(trackedBatches, target.name);
      for (const batch of currentBatches) {
        if (dashboardOptions.eventOnly && !before.has(batch.id)) logLaunch(ns, 'BATCH', batch);
      }
      targetStatuses.push({ target: target.name, state: 'batching', pipeline: currentBatches.length });
    }

    for (const status of targetStatuses) {
      if (!targetOrder.has(status.target)) targetOrder.set(status.target, nextTargetOrder++);
      const prep = activePrepForTarget(trackedPreps, status.target);
      const batches = activeBatchesForTarget(trackedBatches, status.target);
      const landings = [...batches, ...(prep ? [prep] : [])].map((job) => job.expectedLanding).filter(Number.isFinite);
      status.prepKind = prep?.kind ?? '-';
      status.nextLanding = landings.length > 0 ? Math.min(...landings) : null;
    }
    targetStatuses.sort((a, b) => targetOrder.get(a.target) - targetOrder.get(b.target));
    fillXpRam(ns, workers, xpEnabled);
    const activeXpWorkers = xpProcesses(ns, workers);
    publishTrackingSnapshot(
      ns,
      trackedBatches,
      trackedPreps,
      targetStatuses,
      trackingPort,
      dispatchAttempts,
      operationalState.latestFailure,
      {
        eventOnly: dashboardOptions.eventOnly,
        statusInterval: dashboardOptions.interval,
        xpEnabled,
        xpWorkers: activeXpWorkers.length,
        xpThreads: activeXpWorkers.reduce((total, process) => total + process.threads, 0),
      },
    );
    initialRecoveryPass = false;
    if (!dashboardOptions.eventOnly && Date.now() - lastStatusAt >= dashboardOptions.interval) {
      renderStatus(ns, targetStatuses, trackedBatches, trackedPreps, operationalState.latestFailure, activeXpWorkers);
      lastStatusAt = Date.now();
    }

    await ns.sleep(250); // tight loop; we’re using delays for timing
  }
}
