/** @param {NS} ns */

import __vite__cjsImport0_domain from "domain"; const create = __vite__cjsImport0_domain["create"];

function ensureCorporationExists(ns) {
    const corp = ns.corporation;
    if (!corp.hasCorporation()) {
        ns.tprint("You don't have a corporation yet. Creating one for you...");
        corp.createCorporation("Bahl Holdings", false);
    }
    else {
        ns.tprint("You already have a corporation.");
    }
    ns.tprint("Corporation setup complete.");
}

export async function main(ns) {
    ensureCorporationExists(ns);
    createDivision(ns, "Agriculture", ["Farm1", "Farm2"]);
    
}