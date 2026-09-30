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
  const visited = new Set();
  const pending = [ns.getHostname()];
  let killed = 0;

  while (pending.length > 0) {
    const host = pending.pop();
    if (visited.has(host)) continue;
    visited.add(host);
    pending.push(...ns.scan(host).filter((neighbor) => !visited.has(neighbor)));

    for (const process of ns.ps(host)) {
      // PIDs increase as scripts launch, so only an older copy is eligible.
      // This prevents two nearly simultaneous launches from killing the newer one.
      if (process.filename === scriptName && process.pid < ns.pid && ns.kill(process.pid)) {
        killed += 1;
      }
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

/** @param {NS} ns */
function buyDivisionMaterials(ns, divisionName) {
  const corp = ns.corporation;
  const division = corp.getDivision(divisionName);
  const cities = division.cities.filter((city) => corp.hasWarehouse(divisionName, city));
  const industry = corp.getIndustryData(division.industry);
  const materials = BOOST_MATERIALS.filter(([, factor]) => industry[factor] > 0).map(([material]) => material);
  if (cities.length === 0 || materials.length === 0) return;

  // Keep a portion of every warehouse empty for production inputs and output.
  // Track purchases planned below because sizeUsed does not update until the
  // corporation processes its next purchase state.
  const availableSpace = new Map(
    cities.map((city) => {
      const warehouse = corp.getWarehouse(divisionName, city);
      const reservedSpace = warehouse.size * WAREHOUSE_PRODUCTION_RESERVE;
      return [city, Math.max(0, warehouse.size - warehouse.sizeUsed - reservedSpace)];
    }),
  );

  // The last completed cycle is stable while the current cycle's figures reset
  // between corporation states.
  const profitRate = Math.max(0, division.lastCycleRevenue - division.lastCycleExpenses);
  const budgetPerMaterial = (profitRate * MATERIAL_BUDGET_FRACTION) / materials.length;
  const canExport = corp.hasUnlock('Export');

  for (const materialName of materials) {
    const materialSize = corp.getMaterialData(materialName).size;
    const prices = cities.map((city) => ({
      city,
      price: corp.getMaterial(divisionName, city, materialName).marketPrice,
    }));

    if (canExport) {
      const cheapest = prices.reduce((best, current) => (current.price < best.price ? current : best));
      const budgetAmount = budgetPerMaterial / (cheapest.price * cities.length);
      const sourceCapacity =
        availableSpace.get(cheapest.city) / (materialSize * CORPORATION_CYCLE_SECONDS * cities.length);
      const destinationCapacity = Math.min(
        ...cities
          .filter((city) => city !== cheapest.city)
          .map((city) => availableSpace.get(city) / (materialSize * CORPORATION_CYCLE_SECONDS)),
      );
      const amountPerCity = Math.max(0, Math.min(budgetAmount, sourceCapacity, destinationCapacity));

      for (const city of cities) {
        corp.buyMaterial(divisionName, city, materialName, city === cheapest.city ? amountPerCity * cities.length : 0);
        if (city !== cheapest.city) {
          setExportRoute(ns, divisionName, cities, cheapest.city, city, materialName, amountPerCity);
        }
      }

      availableSpace.set(
        cheapest.city,
        availableSpace.get(cheapest.city) - amountPerCity * cities.length * materialSize * CORPORATION_CYCLE_SECONDS,
      );
      for (const city of cities) {
        if (city === cheapest.city) continue;
        availableSpace.set(city, availableSpace.get(city) - amountPerCity * materialSize * CORPORATION_CYCLE_SECONDS);
      }
    } else {
      // Buying identical units in each city costs amount * sum(city prices).
      const budgetAmount = budgetPerMaterial / prices.reduce((total, entry) => total + entry.price, 0);
      const capacityAmount = Math.min(
        ...cities.map((city) => availableSpace.get(city) / (materialSize * CORPORATION_CYCLE_SECONDS)),
      );
      const amountPerCity = Math.max(0, Math.min(budgetAmount, capacityAmount));
      for (const city of cities) {
        corp.buyMaterial(divisionName, city, materialName, amountPerCity);
        availableSpace.set(city, availableSpace.get(city) - amountPerCity * materialSize * CORPORATION_CYCLE_SECONDS);
      }
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
