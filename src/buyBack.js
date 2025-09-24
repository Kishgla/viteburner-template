/** @param {NS} ns */

// ANSI color coding.
const red = "\x1b[31m";
const reset = "\x1b[0m";

export async function main(ns) {
    while (true) {
        // buy back shares each second
        const corp = ns.corporation.getCorporation();
        const div = corp.dividendEarnings;
        const buyBackMargin = 0.5; // spend up to 50% of dividend earnings on buyback
        const buyBackCost = div * buyBackMargin;
        const marketPrice = corp.sharePrice;
        const sharesToBuy = Math.floor(buyBackCost / marketPrice);
        if (sharesToBuy > 0) {
            try {
            ns.corporation.buyBackShares(sharesToBuy);
            ns.print(`Bought back ${sharesToBuy} shares at $${marketPrice.toFixed(2)} each, spending $${(sharesToBuy * marketPrice).toFixed(2)}`);
            } catch (e) {
                ns.print(`${red}Error buying back shares: ${e}${reset}`);
            }
        }

        await ns.sleep(1000);
    }
}