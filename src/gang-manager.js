/** Bitburner – Gang Manager (BN2)
 *  - Auto-recruit, train, task, buy equipment, ascend, and manage warfare
 *  - Works for hacking or combat gangs (auto-detected)
 *
 * Usage:
 *  run gang-manager.js
 *  run gang-manager.js --interval 2000 --reserve 0.1 --ascendGain 1.5 --trainCap 400 --noWar
 *
 * Flags:
 *  --interval   ms between loops (default 2000)
 *  --reserve    fraction of home cash to keep (default 0.10 = 10%)
 *  --ascendGain minimum *combined* ascension mult product to ascend (default 1.5)
 *  --trainCap   stat threshold to stop "Train" for most members (default 400)
 *  --wantedCap  max wanted penalty before assigning vigi (default 0.95)
 *  --warMin     min power ratio to enable warfare (default 1.25)
 *  --warShare   fraction of members to put into warfare when on (default 0.35)
 *  --noWar      disable territory warfare entirely (default false)
 *
 * Notes:
 *  - Requires Singularity? No. Only uses Gang API.
 *  - Territory warfare is toggled cautiously – tune flags above to your taste.
 */

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags([
    ["interval", 2000],
    ["reserve", 0.10],
    ["ascendGain", 1.5],
    ["trainCap", 400],
    ["wantedCap", 0.95],
    ["warMin", 1.25],
    ["warShare", 0.35],
    ["noWar", false],
  ]);

  ns.disableLog("sleep");

  // Wait here until a gang is formed
  await waitForGang(ns);

  while (true) {
    // If gang gets disbanded while running, go back to waiting mode
    if (!ns.gang.inGang()) {
      ns.tprint("⚠️ Gang disbanded (or not formed yet). Pausing management until a gang exists.");
      await waitForGang(ns);
    }

    try {
      const info = ns.gang.getGangInformation();
      const isHacking = info.isHacking;

      recruitLoop(ns);

      // Refresh after potential recruits
      const all = ns.gang.getMemberNames();

      // Buy equipment & augs (cheap first, keep reserve)
      buyEquipment(ns, all, flags.reserve);

      // Ascend if worth it (per member)
      ascendPass(ns, all, flags.ascendGain);

      // Decide global constraints
      const wantedPenalty = ns.gang.getGangInformation().wantedPenalty; // 0..1
      const needVigi = wantedPenalty < flags.wantedCap;

      // Territory management
      manageTerritory(ns, flags, isHacking);

      // Task assignment
      assignTasks(ns, all, {
        isHacking,
        needVigi,
        trainCap: flags.trainCap,
        warShare: flags.warShare,
        warfareOn: ns.gang.getGangInformation().territoryWarfare,
      });

    } catch (e) {
      ns.print(`⚠️ gang-manager error: ${String(e)}`);
    }

    await ns.sleep(flags.interval);
  }
}

/** Waits in 10s intervals until a gang exists, printing a message once. */
async function waitForGang(ns) {
  let announced = false;
  while (!ns.gang.inGang()) {
    if (!announced) {
      ns.tprint("⏳ Not in a gang yet. Waiting every 10s...");
      announced = true;
    }
    await ns.sleep(10_000);
  }
  ns.tprint("✅ Gang detected. Starting management loop.");
}


/** ────────────────────────────────────────────────────────────────────────────
 * Recruiting
 * ────────────────────────────────────────────────────────────────────────────*/
function recruitLoop(ns) {
  while (ns.gang.canRecruitMember()) {
    const name = nextName(ns);
    if (ns.gang.recruitMember(name)) {
      ns.tprint(`🧑‍🤝‍🧑 Recruited ${name}`);
    } else {
      break;
    }
  }
}

function nextName(ns) {
  const base = "m";
  const existing = new Set(ns.gang.getMemberNames());
  for (let i = 0; i < 1000; i++) {
    const name = `${base}${i}`;
    if (!existing.has(name)) return name;
  }
  // fallback
  return `m${Date.now()}`;
}

/** ────────────────────────────────────────────────────────────────────────────
 * Equipment & Augments
 * ────────────────────────────────────────────────────────────────────────────*/
function buyEquipment(ns, members, reserveFrac) {
  const money = ns.getServerMoneyAvailable("home");
  const budget = money * (1 - reserveFrac);

  if (budget <= 0) return;

  // Known equipment names via API:
  const equip = ns.gang.getEquipmentNames(); // includes augs & gear
  // Buy cheaper first
  const byCost = equip
    .map((e) => ({ name: e, cost: ns.gang.getEquipmentCost(e) }))
    .filter((x) => Number.isFinite(x.cost) && x.cost > 0)
    .sort((a, b) => a.cost - b.cost);

  for (const m of members) {
    for (const { name, cost } of byCost) {
      if (ns.gang.getMemberInformation(m).upgrades.includes(name)) continue;
      if (ns.gang.getMemberInformation(m).augmentations.includes(name)) continue;
      const cash = ns.getServerMoneyAvailable("home");
      if (cash * (1 - reserveFrac) < cost) break;
      try {
        if (ns.gang.purchaseEquipment(m, name)) {
          ns.print(`🛒 Bought ${name} for ${m} (${ns.formatNumber(cost, "$0.00a")})`);
        }
      } catch { /* ignore */ }
    }
  }
}

/** ────────────────────────────────────────────────────────────────────────────
 * Ascension
 * ────────────────────────────────────────────────────────────────────────────*/
function ascendPass(ns, members, minProductGain = 1.5) {
  for (const m of members) {
    const res = ns.gang.getAscensionResult(m);
    if (!res) continue;
    // Product of gains across relevant stats
    const product = (res.str || 1) * (res.def || 1) * (res.dex || 1) * (res.agi || 1) *
                    (res.cha || 1) * (res.hack || 1);
    if (product >= minProductGain) {
      const ok = ns.gang.ascendMember(m);
      if (ok) ns.tprint(`⬆️ Ascended ${m} (x≈${product.toFixed(2)})`);
    }
  }
}

/** ────────────────────────────────────────────────────────────────────────────
 * Territory warfare (global)
 * ────────────────────────────────────────────────────────────────────────────*/
function manageTerritory(ns, flags, isHacking) {
  if (flags.noWar) {
    if (ns.gang.getGangInformation().territoryWarfare) {
      ns.gang.setTerritoryWarfare(false);
    }
    return;
  }
  const info = ns.gang.getGangInformation();
  const myPower = info.power;
  const others = ns.gang.getOtherGangInformation();
  // Compute max opponent power
  let maxOpp = 0;
  for (const [name, gi] of Object.entries(others)) {
    if (name === info.faction) continue;
    maxOpp = Math.max(maxOpp, gi.power);
  }
  const ratio = maxOpp > 0 ? (myPower / maxOpp) : 2;

  const shouldWar = ratio >= flags.warMin;
  ns.gang.setTerritoryWarfare(shouldWar);
}

/** ────────────────────────────────────────────────────────────────────────────
 * Task assignment
 * ────────────────────────────────────────────────────────────────────────────*/
function assignTasks(ns, members, opts) {
  const { isHacking, needVigi, trainCap, warShare, warfareOn } = opts;

  // Build task sets dynamically from API names (for compatibility)
  const trainTask = isHacking ? "Train Hacking" : "Train Combat";
  const vigiTask = "Vigilante Justice";
  const warTask = "Territory Warfare";

  // Reasonable money tasks by type (ordered roughly by progression)
  const moneyTasks = isHacking
    ? ["Mug People", "Deal Drugs", "Human Trafficking"] // fallback if hacking list missing
    : ["Mug People", "Deal Drugs", "Traffick Illegal Arms", "Strongarm Civilians", "Human Trafficking"];

  // Better: detect hacking tasks actually flagged as hacking via getTaskStats
  const allTasks = ns.gang.getTaskNames();
  const hackingMoney = allTasks.filter(t => ns.gang.getTaskStats(t).isHacking && ns.gang.getTaskStats(t).baseMoney > 0);
  const combatMoney = allTasks.filter(t => ns.gang.getTaskStats(t).isHacking === false && ns.gang.getTaskStats(t).baseMoney > 0);

  const moneyList = (isHacking && hackingMoney.length) ? hackingMoney : (!isHacking && combatMoney.length ? combatMoney : moneyTasks);

  // Respect farming tasks (non-violent for safer wanted)
  const respectTasks = allTasks
    .filter(t => ns.gang.getTaskStats(t).baseRespect > 0)
    .sort((a, b) => ns.gang.getTaskStats(b).baseRespect - ns.gang.getTaskStats(a).baseRespect);

  // Decide member roles
  const memInfos = members.map(m => ({ name: m, info: ns.gang.getMemberInformation(m) }));

  // 1) Handle wanted: dedicate a couple to vigi if penalty is bad
  const assignCountVigi = needVigi ? Math.max(1, Math.floor(members.length * 0.2)) : 0;

  // 2) Warfare: assign fraction to war when enabled
  const assignCountWar = warfareOn ? Math.floor(members.length * warShare) : 0;

  // 3) Training threshold per member
  const needTrain = (mi) => {
    if (isHacking) {
      return mi.hack < trainCap || mi.cha < Math.min(200, trainCap);
    } else {
      // average of main combat stats
      const avg = (mi.str + mi.def + mi.dex + mi.agi) / 4;
      return avg < trainCap;
    }
  };

  // Sort members by stat level so weaker ones train first
  memInfos.sort((a, b) => memberPower(b.info, isHacking) - memberPower(a.info, isHacking));

  // Assign loop
  let vigiLeft = assignCountVigi;
  let warLeft = assignCountWar;

  for (const { name, info } of memInfos) {
    // Training first for weak members (unless we *really* need vigi/war)
    if (needTrain(info) && vigiLeft === 0 && warLeft === 0) {
      setTask(ns, name, trainTask);
      continue;
    }

    // Wanted control
    if (vigiLeft > 0) {
      setTask(ns, name, vigiTask);
      vigiLeft--;
      continue;
    }

    // Warfare
    if (warLeft > 0) {
      setTask(ns, name, warTask);
      warLeft--;
      continue;
    }

    // Money default – pick the best of moneyList by simple expected value heuristic
    const best = pickBestTask(ns, name, moneyList);
    setTask(ns, name, best ?? (isHacking ? "Train Hacking" : "Train Combat"));
  }
}

function memberPower(mi, isHacking) {
  if (isHacking) {
    return mi.hack * Math.sqrt(Math.max(1, mi.cha));
  }
  const combat = (mi.str + mi.def + mi.dex + mi.agi) / 4;
  return combat * Math.sqrt(Math.max(1, mi.cha));
}

function pickBestTask(ns, member, list) {
  // Use baseMoney and difficulty as rough proxy; you can refine with your own formula
  let best = null, bestScore = -Infinity;
  for (const t of list) {
    const s = ns.gang.getTaskStats(t);
    if (s.baseMoney <= 0) continue;

    // Very rough "success" proxy using stats vs difficulty; Bitburner abstracts success internally,
    // but higher difficulty generally favors stronger members.
    const mi = ns.gang.getMemberInformation(member);
    const stat = s.isHacking ? mi.hack : (mi.str + mi.def + mi.dex + mi.agi) / 4;
    const diff = Math.max(1, s.difficulty);
    const successish = stat / (stat + diff * 100); // squashed 0..1 proxy

    const wantedPenalty = ns.gang.getGangInformation().wantedPenalty;
    const score = s.baseMoney * successish * wantedPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best || list[0];
}

function setTask(ns, member, task) {
  const cur = ns.gang.getMemberInformation(member).task;
  if (cur !== task) {
    ns.gang.setMemberTask(member, task);
    ns.print(`🧭 ${member} → ${task}`);
  }
}
