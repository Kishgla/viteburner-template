/** @param {NS} ns */

const ENERGY_TARGET = 0.99;
const MORALE_TARGET = 0.99;
const TEA_COST_PER_EMPLOYEE = 500_000;
const PARTY_COST_PER_EMPLOYEE = 500_000;
const MATERIAL_BUDGET_FRACTION = 0.5;
const WAREHOUSE_PRODUCTION_RESERVE = 0.1;
const CORPORATION_CYCLE_SECONDS = 10;
const BOOST_MATERIALS = [
  ['Hardware', 'hardwareFactor'],
  ['Robots', 'robotFactor'],
  ['AI Cores', 'aiCoreFactor'],
  ['Real Estate', 'realEstateFactor'],
];

/** @param {NS} ns */
function killOlderInstances(ns) {
  const scriptName = ns.getScriptName();
  let killed = 0;

  for (const process of ns.ps('home')) {
    // PIDs increase as scripts launch, so only an older copy is eligible.
    // This prevents two nearly simultaneous launches from killing the newer one.
    if (process.filename === scriptName && process.pid < ns.pid && ns.kill(process.pid)) {
      killed += 1;
    }
  }

  if (killed > 0) ns.tprint(`Replaced ${killed} older instance${killed === 1 ? '' : 's'} of ${scriptName}.`);
}

function ensureCorporationExists(ns) {
  const corp = ns.corporation;
  if (corp.hasCorporation()) return true;

  // Seed money is free, but is only available in BitNode 3. Fall back to
  // self-funding when the player has the required money/source file.
  for (const selfFund of [false, true]) {
    if (corp.canCreateCorporation(selfFund) !== 'Success') continue;

    if (corp.createCorporation('Bahl Holdings', selfFund)) {
      ns.tprint('Created corporation "Bahl Holdings".');
      return true;
    }
  }

  ns.tprint('ERROR: Unable to create a corporation yet.');
  return false;
}

/** @param {NS} ns */
function maintainOffice(ns, divisionName, city) {
  const corp = ns.corporation;
  const office = corp.getOffice(divisionName, city);
  if (office.numEmployees === 0) return;

  let availableFunds = corp.getCorporation().funds;

  if (office.avgEnergy < office.maxEnergy * ENERGY_TARGET) {
    const teaCost = office.numEmployees * TEA_COST_PER_EMPLOYEE;
    if (availableFunds >= teaCost && corp.buyTea(divisionName, city)) {
      availableFunds -= teaCost;
      ns.print(`Bought tea for ${divisionName} in ${city} (energy: ${office.avgEnergy.toFixed(1)}).`);
    }
  }

  if (office.avgMorale < office.maxMorale * MORALE_TARGET) {
    const partyCost = office.numEmployees * PARTY_COST_PER_EMPLOYEE;
    if (availableFunds >= partyCost && corp.throwParty(divisionName, city, PARTY_COST_PER_EMPLOYEE) > 0) {
      ns.print(`Threw a party for ${divisionName} in ${city} (morale: ${office.avgMorale.toFixed(1)}).`);
    }
  }
}

/** @param {NS} ns */
function maintainEmployees(ns) {
  const corp = ns.corporation;

  for (const divisionName of corp.getCorporation().divisions) {
    for (const city of corp.getDivision(divisionName).cities) {
      try {
        maintainOffice(ns, divisionName, city);
      } catch (error) {
        ns.print(`WARN: Could not maintain ${divisionName} in ${city}: ${String(error)}`);
      }
    }
  }
}

/**
 * Make sure a material has exactly one export route to the target city.
 * Existing routes from a previously-cheapest source city are removed.
 * @param {NS} ns
 */
function setExportRoute(ns, divisionName, cities, sourceCity, targetCity, materialName, amount) {
  const corp = ns.corporation;
  let hasCurrentRoute = false;

  for (const city of cities) {
    const route = corp
      .getMaterial(divisionName, city, materialName)
      .exports.find((order) => order.division === divisionName && order.city === targetCity);
    if (!route) continue;

    const routeIsCurrent = city === sourceCity && Math.abs(Number(route.amount) - amount) < 1e-9;
    if (routeIsCurrent) {
      hasCurrentRoute = true;
    } else {
      corp.cancelExportMaterial(divisionName, city, divisionName, targetCity, materialName);
    }
  }

  if (!hasCurrentRoute && amount > 0) {
    corp.exportMaterial(divisionName, sourceCity, divisionName, targetCity, materialName, amount);
  }
}

/**
 * Calculate the exact Lagrange optimum for a fixed amount of boost-material
 * storage. Negative solutions are removed and the formula is recalculated to
 * enforce the quantity >= 0 constraints.
 * @param {NS} ns
 */
function getOptimalBoostQuantities(ns, industry, storageSpace) {
  const quantities = new Map(BOOST_MATERIALS.map(([material]) => [material, 0]));
  let active = BOOST_MATERIALS.map(([material, factor]) => ({
    material,
    coefficient: industry[factor] ?? 0,
    size: ns.corporation.getMaterialData(material).size,
  })).filter(({ coefficient }) => coefficient > 0);

  while (active.length > 0) {
    const coefficientSum = active.reduce((sum, entry) => sum + entry.coefficient, 0);
    const sizeSum = active.reduce((sum, entry) => sum + entry.size, 0);
    const results = active.map((entry) => ({
      ...entry,
      quantity: (entry.coefficient * (storageSpace + 500 * sizeSum)) / (entry.size * coefficientSum) - 500,
    }));
    const positive = results.filter(({ quantity }) => quantity > 0);

    if (positive.length === results.length) {
      for (const { material, quantity } of results) quantities.set(material, quantity);
      break;
    }
    active = positive;
  }

  return quantities;
}

/** @param {NS} ns */
function buyDivisionMaterials(ns, divisionName) {
  const corp = ns.corporation;
  const division = corp.getDivision(divisionName);
  const cities = division.cities.filter((city) => corp.hasWarehouse(divisionName, city));
  const industry = corp.getIndustryData(division.industry);
  const canExport = corp.hasUnlock('Export');
  const materials = BOOST_MATERIALS.filter(([, factor]) => industry[factor] > 0).map(([material]) => material);
  if (cities.length === 0 || materials.length === 0) return;

  const cityData = new Map();
  for (const city of cities) {
    const warehouse = corp.getWarehouse(divisionName, city);
    const stored = new Map(
      BOOST_MATERIALS.map(([material]) => [material, corp.getMaterial(divisionName, city, material).stored]),
    );
    const boostSpaceUsed = BOOST_MATERIALS.reduce(
      (total, [material]) => total + stored.get(material) * corp.getMaterialData(material).size,
      0,
    );
    const nonBoostSpaceUsed = Math.max(0, warehouse.sizeUsed - boostSpaceUsed);
    const boostSpaceTarget = Math.max(0, warehouse.size * (1 - WAREHOUSE_PRODUCTION_RESERVE) - nonBoostSpaceUsed);
    const targets = getOptimalBoostQuantities(ns, industry, boostSpaceTarget);
    cityData.set(city, { warehouse, stored, targets, boostSpaceTarget });

    // Sell toward the optimum rather than using MAX, which could overshoot it.
    for (const [material] of BOOST_MATERIALS) {
      const excess = stored.get(material) - targets.get(material);
      corp.buyMaterial(divisionName, city, material, 0);
      corp.sellMaterial(
        divisionName,
        city,
        material,
        excess > 0 ? String(excess / CORPORATION_CYCLE_SECONDS) : '0',
        'MP',
      );
    }
  }

  const profitRate = Math.max(0, division.lastCycleRevenue - division.lastCycleExpenses);
  const purchaseBudget = profitRate * MATERIAL_BUDGET_FRACTION;
  const transientSpace = new Map(
    cities.map((city) => {
      const { warehouse } = cityData.get(city);
      return [city, Math.max(0, warehouse.size * (1 - WAREHOUSE_PRODUCTION_RESERVE) - warehouse.sizeUsed)];
    }),
  );
  const plans = [];

  for (const material of materials) {
    const materialSize = corp.getMaterialData(material).size;
    const deficits = new Map(
      cities.map((city) => {
        const data = cityData.get(city);
        return [city, Math.max(0, data.targets.get(material) - data.stored.get(material))];
      }),
    );

    if (canExport) {
      // Prefer the cheapest city that can temporarily hold purchases before
      // the EXPORT state. This falls back to another city instead of stalling
      // when the absolute cheapest warehouse is already at its target.
      const sourceCandidates = cities.filter((city) => transientSpace.get(city) > 0);
      const source = (sourceCandidates.length > 0 ? sourceCandidates : cities).reduce((cheapest, city) =>
        corp.getMaterial(divisionName, city, material).marketPrice <
        corp.getMaterial(divisionName, cheapest, material).marketPrice
          ? city
          : cheapest,
      );
      const desiredRate = [...deficits.values()].reduce((sum, amount) => sum + amount, 0) / CORPORATION_CYCLE_SECONDS;
      const capacityRate = transientSpace.get(source) / (materialSize * CORPORATION_CYCLE_SECONDS);
      const rateScale = desiredRate > 0 ? Math.min(1, capacityRate / desiredRate) : 0;
      const exports = new Map(
        cities.map((city) => [
          city,
          city === source ? 0 : (deficits.get(city) / CORPORATION_CYCLE_SECONDS) * rateScale,
        ]),
      );
      const buyRate = desiredRate * rateScale;
      const price = corp.getMaterial(divisionName, source, material).marketPrice;
      plans.push({ material, source, buyRate, exports, costRate: buyRate * price });
      transientSpace.set(
        source,
        Math.max(0, transientSpace.get(source) - buyRate * materialSize * CORPORATION_CYCLE_SECONDS),
      );
    } else {
      for (const city of cities) {
        const desiredRate = deficits.get(city) / CORPORATION_CYCLE_SECONDS;
        const capacityRate = transientSpace.get(city) / (materialSize * CORPORATION_CYCLE_SECONDS);
        const buyRate = Math.min(desiredRate, capacityRate);
        const price = corp.getMaterial(divisionName, city, material).marketPrice;
        plans.push({ material, source: city, buyRate, exports: null, costRate: buyRate * price });
        transientSpace.set(
          city,
          Math.max(0, transientSpace.get(city) - buyRate * materialSize * CORPORATION_CYCLE_SECONDS),
        );
      }
    }
  }

  const plannedCostRate = plans.reduce((sum, plan) => sum + plan.costRate, 0);
  const budgetScale = plannedCostRate > 0 ? Math.min(1, purchaseBudget / plannedCostRate) : 0;

  for (const city of cities) {
    const { warehouse, boostSpaceTarget } = cityData.get(city);
    ns.print(
      `[materials] ${divisionName}/${city}: ` +
        `warehouse=${warehouse.sizeUsed.toFixed(1)}/${warehouse.size.toFixed(1)}, ` +
        `boostTarget=${boostSpaceTarget.toFixed(1)}, ` +
        `profit=${ns.formatNumber(profitRate)}/s, ` +
        `budget=${ns.formatNumber(purchaseBudget)}/s, ` +
        `planned=${ns.formatNumber(plannedCostRate)}/s, ` +
        `scale=${budgetScale.toFixed(6)}`,
    );
  }

  for (const plan of plans) {
    corp.buyMaterial(divisionName, plan.source, plan.material, plan.buyRate * budgetScale);
    if (!plan.exports) continue;
    for (const city of cities) {
      setExportRoute(ns, divisionName, cities, plan.source, city, plan.material, plan.exports.get(city) * budgetScale);
    }
  }
}

/** @param {NS} ns */
export async function main(ns) {
  killOlderInstances(ns);
  ns.disableLog('sleep');

  if (!ensureCorporationExists(ns)) return;

  ns.print('Employee energy and morale maintenance started.');
  while (true) {
    maintainEmployees(ns);
    for (const divisionName of ns.corporation.getCorporation().divisions) {
      try {
        buyDivisionMaterials(ns, divisionName);
      } catch (error) {
        ns.print(`WARN: Could not manage materials for ${divisionName}: ${String(error)}`);
      }
    }

    // A corporation cycle is roughly ten seconds. Using a simple sleep also
    // keeps this compatible with older API versions that lack nextUpdate().
    await ns.sleep(CORPORATION_CYCLE_SECONDS * 1_000);
  }
}
