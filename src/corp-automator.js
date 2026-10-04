/** @param {NS} ns */

const ENERGY_TARGET = 0.99;
const MORALE_TARGET = 0.99;
const TEA_COST_PER_EMPLOYEE = 500_000;
const PARTY_COST_PER_EMPLOYEE = 500_000;
const WAREHOUSE_PRODUCTION_RESERVE = 0.1;
const CORPORATION_CYCLE_SECONDS = 10;
const TELEMETRY_FILE = 'corp-telemetry.txt';
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

function exportAmountsMatch(current, desired) {
  if (typeof desired === 'number') return Math.abs(Number(current) - desired) < 1e-9;
  return String(current) === desired;
}

/**
 * Reconcile the export routes for one source division and material. The filter
 * limits which routes this policy owns, so boost-material routes are untouched.
 * @param {NS} ns
 */
function syncExportRoutes(ns, sourceDivision, sourceCities, material, desiredRoutes, managesRoute) {
  const corp = ns.corporation;
  const activeRoutes = new Set();

  for (const sourceCity of sourceCities) {
    for (const order of [...corp.getMaterial(sourceDivision, sourceCity, material).exports]) {
      if (!managesRoute(order)) continue;

      const desired = desiredRoutes.find(
        (route) =>
          route.sourceCity === sourceCity && route.targetDivision === order.division && route.targetCity === order.city,
      );
      if (desired && exportAmountsMatch(order.amount, desired.amount)) {
        activeRoutes.add(`${sourceCity}\0${order.division}\0${order.city}`);
      } else {
        corp.cancelExportMaterial(sourceDivision, sourceCity, order.division, order.city, material);
      }
    }
  }

  for (const route of desiredRoutes) {
    const key = `${route.sourceCity}\0${route.targetDivision}\0${route.targetCity}`;
    if (activeRoutes.has(key) || route.amount === 0) continue;
    corp.exportMaterial(
      sourceDivision,
      route.sourceCity,
      route.targetDivision,
      route.targetCity,
      material,
      route.amount,
    );
  }
}

/** @param {NS} ns */
function manageProductionExports(ns) {
  const corp = ns.corporation;
  if (!corp.hasUnlock('Export')) return;

  const divisions = corp.getCorporation().divisions.map((name) => {
    const division = corp.getDivision(name);
    const industry = corp.getIndustryData(division.industry);
    const cities = division.cities.filter((city) => corp.hasWarehouse(name, city));
    return { name, division, industry, cities };
  });
  const requiredByMaterial = new Map();

  for (const target of divisions) {
    for (const [material, coefficient] of Object.entries(target.industry.requiredMaterials)) {
      if (coefficient <= 0) continue;
      if (!requiredByMaterial.has(material)) requiredByMaterial.set(material, []);
      requiredByMaterial.get(material).push(target);
    }
  }

  // Supply dependent divisions first. Prefer a producer in the same city and
  // choose the highest-quality source when multiple divisions produce it.
  for (const [material, targets] of requiredByMaterial) {
    const producers = divisions.filter(({ industry }) => industry.producedMaterials?.includes(material));
    const desiredByProducer = new Map(producers.map(({ name }) => [name, []]));

    for (const target of targets) {
      for (const targetCity of target.cities) {
        const candidates = producers
          .filter((producer) => producer.name !== target.name)
          .flatMap((producer) =>
            producer.cities.map((sourceCity) => ({
              producer,
              sourceCity,
              sameCity: sourceCity === targetCity,
              quality: corp.getMaterial(producer.name, sourceCity, material).quality,
            })),
          );
        if (candidates.length === 0) continue;

        const source = candidates.reduce((best, candidate) => {
          if (candidate.sameCity !== best.sameCity) return candidate.sameCity ? candidate : best;
          return candidate.quality > best.quality ? candidate : best;
        });
        desiredByProducer.get(source.producer.name).push({
          sourceCity: source.sourceCity,
          targetDivision: target.name,
          targetCity,
          amount: '(IPROD+IINV/10)*(-1)',
        });
      }
    }

    for (const producer of producers) {
      syncExportRoutes(
        ns,
        producer.name,
        producer.cities,
        material,
        desiredByProducer.get(producer.name),
        (order) => order.division !== producer.name,
      );
    }
  }

  // Balance other produced materials inside their division. A city whose
  // production exceeds sales sends that accumulating surplus to cities that
  // are currently selling through everything they produce.
  const boostMaterialNames = new Set(BOOST_MATERIALS.map(([material]) => material));
  for (const producer of divisions) {
    for (const material of producer.industry.producedMaterials ?? []) {
      if (boostMaterialNames.has(material)) continue;

      const snapshots = producer.cities.map((city) => ({
        city,
        data: corp.getMaterial(producer.name, city, material),
      }));
      const sources = snapshots.filter(({ data }) => data.productionAmount > data.actualSellAmount && data.stored > 0);
      const destinations = snapshots.filter(({ data }) => data.actualSellAmount >= data.productionAmount);
      const desiredRoutes = [];

      // Cross-division consumers have priority over sales balancing.
      if (!requiredByMaterial.has(material) && destinations.length > 0) {
        for (const source of sources) {
          const receivers = destinations.filter(({ city }) => city !== source.city);
          if (receivers.length === 0) continue;
          const surplusRate = source.data.productionAmount - source.data.actualSellAmount;
          for (const receiver of receivers) {
            desiredRoutes.push({
              sourceCity: source.city,
              targetDivision: producer.name,
              targetCity: receiver.city,
              amount: surplusRate / receivers.length,
            });
          }
        }
      }

      syncExportRoutes(
        ns,
        producer.name,
        producer.cities,
        material,
        desiredRoutes,
        (order) => order.division === producer.name,
      );
    }
  }
}

/** @param {NS} ns */
function writeTelemetry(ns, materialPlans) {
  const corp = ns.corporation;
  const corporation = corp.getCorporation();
  const divisions = corporation.divisions.map((divisionName) => {
    const division = corp.getDivision(divisionName);
    const industry = corp.getIndustryData(division.industry);
    const materialNames = [
      ...new Set([
        ...BOOST_MATERIALS.map(([material]) => material),
        ...Object.keys(industry.requiredMaterials),
        ...(industry.producedMaterials ?? []),
      ]),
    ];
    const plan = materialPlans.get(divisionName);

    return {
      name: divisionName,
      industry: division.industry,
      revenue: division.lastCycleRevenue,
      expenses: division.lastCycleExpenses,
      profit: division.lastCycleRevenue - division.lastCycleExpenses,
      plannedBoostPurchaseCostRate: plan?.plannedCostRate ?? 0,
      plannedBoostPurchases: (plan?.plans ?? []).map((entry) => ({
        material: entry.material,
        sourceCity: entry.source,
        buyRate: entry.buyRate,
        costRate: entry.costRate,
        exports: entry.exports ? Object.fromEntries(entry.exports) : null,
      })),
      cities: division.cities
        .filter((city) => corp.hasWarehouse(divisionName, city))
        .map((city) => {
          const warehouse = corp.getWarehouse(divisionName, city);
          return {
            city,
            warehouse: {
              size: warehouse.size,
              sizeUsed: warehouse.sizeUsed,
              utilization: warehouse.size > 0 ? warehouse.sizeUsed / warehouse.size : 0,
              boostSpaceTarget: warehouse.size * (1 - WAREHOUSE_PRODUCTION_RESERVE),
            },
            materials: Object.fromEntries(
              materialNames.map((material) => {
                const data = corp.getMaterial(divisionName, city, material);
                return [
                  material,
                  {
                    stored: data.stored,
                    quality: data.quality,
                    buyAmount: data.buyAmount,
                    productionAmount: data.productionAmount,
                    importAmount: data.importAmount,
                    actualSellAmount: data.actualSellAmount,
                    marketPrice: data.marketPrice,
                    desiredSellAmount: data.desiredSellAmount,
                    desiredSellPrice: data.desiredSellPrice,
                    exports: data.exports,
                  },
                ];
              }),
            ),
          };
        }),
    };
  });

  ns.write(
    TELEMETRY_FILE,
    `${JSON.stringify({
      timestamp: Date.now(),
      corporation: {
        funds: corporation.funds,
        revenue: corporation.revenue,
        expenses: corporation.expenses,
        profit: corporation.revenue - corporation.expenses,
        prevState: corporation.prevState,
        nextState: corporation.nextState,
      },
      divisions,
    })}\n`,
    'a',
  );
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
  if (cities.length === 0 || materials.length === 0) return { plannedCostRate: 0, plans: [] };

  const cityData = new Map();
  for (const city of cities) {
    const warehouse = corp.getWarehouse(divisionName, city);
    const stored = new Map(
      BOOST_MATERIALS.map(([material]) => [material, corp.getMaterial(divisionName, city, material).stored]),
    );
    // Keep the long-term boost target stable. Input/output inventory may pause
    // purchases through transientSpace below, but must not trigger a sell-and-
    // rebuy cycle whenever its stored amount fluctuates.
    const boostSpaceTarget = warehouse.size * (1 - WAREHOUSE_PRODUCTION_RESERVE);
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

  for (const plan of plans) {
    corp.buyMaterial(divisionName, plan.source, plan.material, plan.buyRate);
    if (!plan.exports) continue;
    for (const city of cities) {
      setExportRoute(ns, divisionName, cities, plan.source, city, plan.material, plan.exports.get(city));
    }
  }

  return { plannedCostRate, plans };
}

/** @param {NS} ns */
export async function main(ns) {
  killOlderInstances(ns);
  ns.disableLog('sleep');

  if (!ensureCorporationExists(ns)) return;
  if (ns.args.includes('--reset-telemetry')) ns.write(TELEMETRY_FILE, '', 'w');

  ns.print('Employee energy and morale maintenance started.');
  while (true) {
    maintainEmployees(ns);
    const materialPlans = new Map();
    for (const divisionName of ns.corporation.getCorporation().divisions) {
      try {
        materialPlans.set(divisionName, buyDivisionMaterials(ns, divisionName));
      } catch (error) {
        ns.print(`WARN: Could not manage materials for ${divisionName}: ${String(error)}`);
      }
    }
    try {
      manageProductionExports(ns);
    } catch (error) {
      ns.print(`WARN: Could not manage production exports: ${String(error)}`);
    }
    try {
      writeTelemetry(ns, materialPlans);
    } catch (error) {
      ns.print(`WARN: Could not write corporation telemetry: ${String(error)}`);
    }

    // A corporation cycle is roughly ten seconds. Using a simple sleep also
    // keeps this compatible with older API versions that lack nextUpdate().
    await ns.sleep(CORPORATION_CYCLE_SECONDS * 1_000);
  }
}
