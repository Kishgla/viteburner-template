/** @param {NS} ns */

/*******************************************************************************\
|* Stock Trading Configuration                                                 *|
\*******************************************************************************/

const STOCK_CONFIG = {
    // Trading thresholds
    BUY_THRESHOLD: 0.55,        // Buy if forecast > 55%
    SELL_THRESHOLD: 0.45,       // Sell if forecast < 45%
    SHORT_THRESHOLD: 0.45,      // Short if forecast < 45%
    COVER_THRESHOLD: 0.55,      // Cover shorts if forecast > 55%
    
    // Position sizing
    MAX_POSITION_PCT: 0.8,      // Max 80% of portfolio in one stock
    CASH_RESERVE_PCT: 0.1,      // Keep 10% cash reserve
    
    // Risk management
    STOP_LOSS_PCT: -0.15,       // Stop loss at -15%
    TAKE_PROFIT_PCT: 0.25,      // Take profit at +25%
    
    // Influence settings
    MIN_INFLUENCE_DURATION: 60000,  // Run influence for at least 1 minute
    INFLUENCE_COOLDOWN: 30000,      // Wait 30s between influence changes
};

// ANSI Colors
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BLUE = "\u001b[34m";
const RESET = "\u001b[0m";

/*******************************************************************************\
|* Stock Trading Functions                                                     *|
\*******************************************************************************/

function getStockSymbols(ns) {
    return ns.stock.getSymbols();
}

function getStockInfo(ns, symbol) {
    const position = ns.stock.getPosition(symbol);
    const price = ns.stock.getPrice(symbol);
    const forecast = ns.stock.getForecast(symbol);
    const volatility = ns.stock.getVolatility(symbol);
    const askPrice = ns.stock.getAskPrice(symbol);
    const bidPrice = ns.stock.getBidPrice(symbol);
    const maxShares = ns.stock.getMaxShares(symbol);
    
    return {
        symbol,
        price,
        askPrice,
        bidPrice,
        forecast,
        volatility,
        maxShares,
        longShares: position[0],
        avgLongPrice: position[1],
        shortShares: position[2],
        avgShortPrice: position[3],
        longValue: position[0] * price,
        shortValue: position[2] * price
    };
}

function getPortfolioValue(ns) {
    let totalValue = ns.getPlayer().money;
    const symbols = getStockSymbols(ns);
    
    for (const symbol of symbols) {
        const info = getStockInfo(ns, symbol);
        totalValue += info.longValue - info.shortValue;
    }
    
    return totalValue;
}

function calculatePositionSize(ns, symbol, targetPct) {
    const portfolioValue = getPortfolioValue(ns);
    const targetValue = portfolioValue * targetPct;
    const price = ns.stock.getAskPrice(symbol);
    const maxShares = ns.stock.getMaxShares(symbol);
    const affordableShares = Math.floor(targetValue / price);
    
    return Math.min(affordableShares, maxShares);
}

function shouldBuyStock(info) {
    return info.forecast > STOCK_CONFIG.BUY_THRESHOLD && info.longShares === 0;
}

function shouldSellStock(info) {
    if (info.longShares === 0) return false;
    
    // Check forecast
    if (info.forecast < STOCK_CONFIG.SELL_THRESHOLD) return true;
    
    // Check profit/loss
    const pnlPct = (info.price - info.avgLongPrice) / info.avgLongPrice;
    if (pnlPct <= STOCK_CONFIG.STOP_LOSS_PCT || pnlPct >= STOCK_CONFIG.TAKE_PROFIT_PCT) {
        return true;
    }
    
    return false;
}

function shouldShortStock(ns, info) {
    if (!ns.stock.has4SDataTIXAPI()) return false; // Need 4S data for shorts
    return info.forecast < STOCK_CONFIG.SHORT_THRESHOLD && info.shortShares === 0;
}

function shouldCoverShorts(info) {
    if (info.shortShares === 0) return false;
    
    // Check forecast
    if (info.forecast > STOCK_CONFIG.COVER_THRESHOLD) return true;
    
    // Check profit/loss on short position
    const pnlPct = (info.avgShortPrice - info.price) / info.avgShortPrice;
    if (pnlPct <= STOCK_CONFIG.STOP_LOSS_PCT || pnlPct >= STOCK_CONFIG.TAKE_PROFIT_PCT) {
        return true;
    }
    
    return false;
}

/*******************************************************************************\
|* Market Influence Management                                                 *|
\*******************************************************************************/

class InfluenceManager {
    constructor() {
        this.activeInfluences = new Map(); // symbol -> {direction: 'up'|'down', startTime}
        this.lastInfluenceChange = 0;
    }
    
    updateInfluence(ns, symbol, desiredDirection) {
        const now = Date.now();
        const current = this.activeInfluences.get(symbol);
        
        // Check cooldown
        if (now - this.lastInfluenceChange < STOCK_CONFIG.INFLUENCE_COOLDOWN) {
            return false;
        }
        
        // Check minimum duration
        if (current && now - current.startTime < STOCK_CONFIG.MIN_INFLUENCE_DURATION) {
            return false;
        }
        
        // Update influence if different
        if (!current || current.direction !== desiredDirection) {
            this.activeInfluences.set(symbol, {
                direction: desiredDirection,
                startTime: now
            });
            this.lastInfluenceChange = now;
            
            // Here you would signal your hack scheduler to use the appropriate stock flags
            // This could be done via a file, shared state, or direct function call
            this.signalHackScheduler(ns, symbol, desiredDirection);
            
            return true;
        }
        
        return false;
    }
    
    signalHackScheduler(ns, symbol, direction) {
        // Write influence instructions to a file that your hack scheduler can read
        const instructions = {
            symbol,
            direction, // 'up' or 'down'
            timestamp: Date.now()
        };
        
        try {
            ns.write(`/stock-influence/${symbol}.txt`, JSON.stringify(instructions), "w");
            ns.print(`📈 Set stock influence for ${symbol}: ${direction.toUpperCase()}`);
        } catch (e) {
            ns.print(`${RED}⚠️ Failed to write influence file for ${symbol}${RESET}`);
        }
    }
    
    getActiveInfluences() {
        return new Map(this.activeInfluences);
    }
}

/*******************************************************************************\
|* Main Trading Logic                                                          *|
\*******************************************************************************/

export async function main(ns) {
    ns.disableLog("sleep");
    ns.disableLog("stock.getPrice");
    ns.disableLog("stock.getForecast");
    
    // Check if we have stock market access
    if (!ns.stock.hasTIXAPIAccess()) {
        ns.tprint(`${RED}⚠️ No TIX API access! Buy the TIX API access first.${RESET}`);
        return;
    }
    
    const influenceManager = new InfluenceManager();
    
    ns.tprint(`${GREEN}🔄 Stock trading automation started${RESET}`);
    
    while (true) {
        try {
            const symbols = getStockSymbols(ns);
            const portfolioValue = getPortfolioValue(ns);
            const cash = ns.getPlayer().money;
            const reserveCash = portfolioValue * STOCK_CONFIG.CASH_RESERVE_PCT;
            
            ns.print(`=== Stock Trading Cycle ===`);
            ns.print(`Portfolio Value: $${ns.formatNumber(portfolioValue)}`);
            ns.print(`Available Cash: $${ns.formatNumber(cash)}`);
            
            for (const symbol of symbols) {
                const info = getStockInfo(ns, symbol);
                const pnlLong = info.longShares > 0 ? (info.price - info.avgLongPrice) * info.longShares : 0;
                const pnlShort = info.shortShares > 0 ? (info.avgShortPrice - info.price) * info.shortShares : 0;
                const totalPnL = pnlLong + pnlShort;
                
                // Trading decisions
                let action = "HOLD";
                let influenceDirection = null;
                
                // Long positions
                if (shouldBuyStock(info) && cash > reserveCash) {
                    const shares = calculatePositionSize(ns, symbol, STOCK_CONFIG.MAX_POSITION_PCT);
                    const cost = shares * info.askPrice + 100000; // Include commission
                    
                    if (cash >= cost + reserveCash && shares > 0) {
                        const actualCost = ns.stock.buyStock(symbol, shares);
                        if (actualCost > 0) {
                            action = `BUY ${shares} @ $${info.askPrice.toFixed(2)}`;
                            influenceDirection = "up";
                        }
                    }
                } else if (shouldSellStock(info)) {
                    const proceeds = ns.stock.sellStock(symbol, info.longShares);
                    if (proceeds > 0) {
                        const pnlPct = ((proceeds / info.longShares - info.avgLongPrice) / info.avgLongPrice * 100);
                        action = `SELL ${info.longShares} @ $${info.price.toFixed(2)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;
                    }
                }
                
                // Short positions (if 4S data available)
                if (ns.stock.has4SDataTIXAPI()) {
                    if (shouldShortStock(ns, info) && cash > reserveCash) {
                        const shares = calculatePositionSize(ns, symbol, STOCK_CONFIG.MAX_POSITION_PCT);
                        const cost = shares * info.bidPrice + 100000;
                        
                        if (cash >= cost + reserveCash && shares > 0) {
                            const actualCost = ns.stock.buyShort(symbol, shares);
                            if (actualCost > 0) {
                                action = `SHORT ${shares} @ $${info.bidPrice.toFixed(2)}`;
                                influenceDirection = "down";
                            }
                        }
                    } else if (shouldCoverShorts(info)) {
                        const proceeds = ns.stock.sellShort(symbol, info.shortShares);
                        if (proceeds > 0) {
                            const pnlPct = ((info.avgShortPrice - proceeds / info.shortShares) / info.avgShortPrice * 100);
                            action = `COVER ${info.shortShares} @ $${info.price.toFixed(2)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;
                        }
                    }
                }
                
                // Set market influence based on positions
                if (!influenceDirection) {
                    if (info.longShares > 0) influenceDirection = "up";
                    else if (info.shortShares > 0) influenceDirection = "down";
                }
                
                if (influenceDirection) {
                    influenceManager.updateInfluence(ns, symbol, influenceDirection);
                }
                
                // Logging
                if (action !== "HOLD" || totalPnL !== 0) {
                    const color = totalPnL > 0 ? GREEN : totalPnL < 0 ? RED : "";
                    ns.print(`${symbol}: ${action} | Forecast: ${(info.forecast * 100).toFixed(1)}% | P&L: ${color}$${ns.formatNumber(totalPnL)}${RESET}`);
                }
            }
            
        } catch (error) {
            ns.print(`${RED}ERROR: ${error.message}${RESET}`);
        }
        
        await ns.sleep(10000); // Check every 10 seconds
    }
}