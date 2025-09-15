/** @param {NS} ns */

const WANTED_PENALTY_THRESHOLD = 2; // Start vigilante work if wanted penalty > this
const TRAINING_THRESHOLDS = {
    hacking: 100,  // Train hacking if below this level
    combat: 100    // Train combat if below this level (average of str/def/dex/agi)
};

// Ascension settings
const ASCENSION_THRESHOLD = 1.5; // Ascend if any multiplier would improve by this factor

// Equipment settings
const EQUIPMENT_CONFIG = {
    BUDGET_RATIO: 0.15,           // Spend up to 15% of money on equipment
    MIN_CASH_RESERVE: 100000000,  // Keep at least 100M cash
    PRIORITIZE_CHEAPEST: true,    // Buy cheapest equipment first, or most expensive
};

// Task priorities (higher number = higher priority for money/respect)
const TASKS = {
    // Training tasks
    TRAIN_HACKING: "Train Hacking",
    TRAIN_COMBAT: "Train Combat",
    
    // Money/Respect tasks (adjust based on your gang's available tasks)
    RANSOMWARE: "Ransomware",
    PHISHING: "Phishing", 
    IDENTITY_THEFT: "Identity Theft",
    DDoS_ATTACKS: "DDoS Attacks",
    MONEY_LAUNDERING: "Money Laundering",
    CYBERTERRORISM: "Cyberterrorism",
    
    // Vigilante task
    VIGILANTE_JUSTICE: "Vigilante Justice"
};

function getMemberStats(ns, memberName) {
    const info = ns.gang.getMemberInformation(memberName);
    const avgCombat = (info.str + info.def + info.dex + info.agi) / 4;
    return {
        name: memberName,
        hacking: info.hack,
        combat: avgCombat,
        info: info
    };
}

function needsHackingTraining(member) {
    return member.hacking < TRAINING_THRESHOLDS.hacking;
}

function needsCombatTraining(member) {
    return member.combat < TRAINING_THRESHOLDS.combat;
}

function getBestMoneyRespectTask(ns, member) {
    // Get all available tasks and calculate best option
    const availableTasks = [
        TASKS.CYBERTERRORISM,
        TASKS.MONEY_LAUNDERING,
        TASKS.DDoS_ATTACKS,
        TASKS.IDENTITY_THEFT,
        TASKS.PHISHING,
        TASKS.RANSOMWARE
    ];
    
    let bestTask = availableTasks[0];
    let bestScore = 0;
    
    for (const task of availableTasks) {
        try {
            const taskStats = ns.gang.getTaskStats(task);
            
            // Simple scoring: prioritize tasks with higher base rewards
            // Weight respect slightly lower than money
            const score = taskStats.baseMoney + (taskStats.baseRespect * 0.1);
            
            if (score > bestScore) {
                bestScore = score;
                bestTask = task;
            }
        } catch (e) {
            // Task doesn't exist, skip it
            continue;
        }
    }
    
    return bestTask;
}

function getEquipmentUpgrades(ns) {
    const equipmentNames = ns.gang.getEquipmentNames();
    const equipment = [];
    
    for (const name of equipmentNames) {
        const stats = ns.gang.getEquipmentStats(name);
        const cost = ns.gang.getEquipmentCost(name);
        
        equipment.push({
            name,
            cost,
            type: ns.gang.getEquipmentType(name),
            stats,
            // Calculate total stat benefit for prioritization
            totalBenefit: (stats.str || 0) + (stats.def || 0) + (stats.dex || 0) + 
                         (stats.agi || 0) + (stats.hack || 0) + (stats.cha || 0)
        });
    }
    
    return equipment;
}

function getMemberEquipment(ns, memberName) {
    try {
        const memberInfo = ns.gang.getMemberInformation(memberName);
        return memberInfo.upgrades || [];
    } catch (e) {
        return [];
    }
}

function findBestEquipmentForMember(ns, memberName, availableBudget) {
    const memberEquipment = getMemberEquipment(ns, memberName);
    const allEquipment = getEquipmentUpgrades(ns);
    
    // Filter out equipment member already has
    const availableEquipment = allEquipment.filter(eq => !memberEquipment.includes(eq.name));
    
    if (availableEquipment.length === 0) return null;
    
    // Filter by budget
    const affordableEquipment = availableEquipment.filter(eq => eq.cost <= availableBudget);
    
    if (affordableEquipment.length === 0) return null;
    
    // Sort by preference (cheapest first or most expensive first)
    if (EQUIPMENT_CONFIG.PRIORITIZE_CHEAPEST) {
        affordableEquipment.sort((a, b) => a.cost - b.cost);
    } else {
        affordableEquipment.sort((a, b) => b.cost - a.cost);
    }
    
    return affordableEquipment[0];
}

function manageEquipment(ns) {
    const playerMoney = ns.getPlayer().money;
    const equipmentBudget = Math.max(0, 
        Math.min(
            playerMoney * EQUIPMENT_CONFIG.BUDGET_RATIO,
            playerMoney - EQUIPMENT_CONFIG.MIN_CASH_RESERVE
        )
    );
    
    if (equipmentBudget <= 0) return;
    
    const members = ns.gang.getMemberNames();
    let remainingBudget = equipmentBudget;
    let purchasesMade = [];
    
    // Round-robin equipment purchases across members
    let purchasesThisRound = 0;
    do {
        purchasesThisRound = 0;
        
        for (const memberName of members) {
            if (remainingBudget <= 0) break;
            
            const bestEquipment = findBestEquipmentForMember(ns, memberName, remainingBudget);
            if (bestEquipment) {
                const success = ns.gang.purchaseEquipment(memberName, bestEquipment.name);
                if (success) {
                    remainingBudget -= bestEquipment.cost;
                    purchasesMade.push({
                        member: memberName,
                        equipment: bestEquipment.name,
                        cost: bestEquipment.cost
                    });
                    purchasesThisRound++;
                }
            }
        }
    } while (purchasesThisRound > 0 && remainingBudget > 0);
    
    // Log purchases
    if (purchasesMade.length > 0) {
        ns.print(`--- Equipment Purchases ---`);
        for (const purchase of purchasesMade) {
            ns.print(`${purchase.member}: ${purchase.equipment} (${ns.formatNumber(purchase.cost)})`);
        }
        ns.print(`Total spent: ${ns.formatNumber(equipmentBudget - remainingBudget)}`);
    }
    
    return purchasesMade.length;
}

function shouldAscendMember(ns, memberName) {
    try {
        const ascensionResult = ns.gang.getAscensionResult(memberName);
        if (!ascensionResult) return false; // Can't ascend yet
        
        // Check if any multiplier would improve by the threshold
        const improvements = [
            ascensionResult.hack || 1,
            ascensionResult.str || 1,
            ascensionResult.def || 1,
            ascensionResult.dex || 1,
            ascensionResult.agi || 1,
            ascensionResult.cha || 1
        ];
        
        const maxImprovement = Math.max(...improvements);
        return maxImprovement >= ASCENSION_THRESHOLD;
    } catch (e) {
        return false; // Error checking ascension, skip
    }
}

export async function main(ns) {
    ns.disableLog("sleep");
    
    while (true) {
        try {
            const members = ns.gang.getMemberNames();
            const memberStats = members.map(name => getMemberStats(ns, name));
            const gangInfo = ns.gang.getGangInformation();
            const wantedPenalty = gangInfo.wantedPenalty || 1;
            
            ns.print(`=== Gang Management Cycle ===`);
            ns.print(`Wanted Penalty: ${wantedPenalty.toFixed(3)}x`);
            ns.print(`Members: ${members.length}`);
            
            // Sort members by combat level (for vigilante assignment)
            const membersByCombat = [...memberStats].sort((a, b) => b.combat - a.combat);
            
            // Track assigned roles
            let hackingTrainerAssigned = false;
            let combatTrainerAssigned = false;
            let vigilanteAssigned = false;
            
            // Assignment logic
            for (const member of memberStats) {
                let assignedTask = null;
                let reason = "";
                
                // 1. Check if we need vigilante justice (highest combat member)
                if (!vigilanteAssigned && wantedPenalty > WANTED_PENALTY_THRESHOLD) {
                    if (member.name === membersByCombat[0].name) {
                        assignedTask = TASKS.VIGILANTE_JUSTICE;
                        reason = "vigilante (wanted penalty too high)";
                        vigilanteAssigned = true;
                    }
                }
                
                // 2. Assign training if needed and slots available
                if (!assignedTask) {
                    if (!hackingTrainerAssigned && needsHackingTraining(member)) {
                        assignedTask = TASKS.TRAIN_HACKING;
                        reason = "hacking training";
                        hackingTrainerAssigned = true;
                    } else if (!combatTrainerAssigned && needsCombatTraining(member)) {
                        assignedTask = TASKS.TRAIN_COMBAT;
                        reason = "combat training";
                        combatTrainerAssigned = true;
                    }
                }
                
                // 3. Default to money/respect tasks
                if (!assignedTask) {
                    assignedTask = getBestMoneyRespectTask(ns, member);
                    reason = "money/respect";
                }
                
                // Assign the task
                const currentTask = ns.gang.getMemberInformation(member.name).task;
                if (currentTask !== assignedTask) {
                    ns.gang.setMemberTask(member.name, assignedTask);
                    ns.print(`${member.name}: ${currentTask} → ${assignedTask} (${reason})`);
                } else {
                    ns.print(`${member.name}: ${assignedTask} (${reason}) - unchanged`);
                }
            }
            
            // Summary
            ns.print(`--- Assignment Summary ---`);
            ns.print(`Hacking Trainer: ${hackingTrainerAssigned ? 'Assigned' : 'None needed'}`);
            ns.print(`Combat Trainer: ${combatTrainerAssigned ? 'Assigned' : 'None needed'}`);
            ns.print(`Vigilante: ${vigilanteAssigned ? 'Assigned' : 'Not needed'}`);
            
            // Check for ascensions after task assignments
            for (const member of memberStats) {
                if (shouldAscendMember(ns, member.name)) {
                    const ascensionResult = ns.gang.getAscensionResult(member.name);
                    const maxGain = Math.max(
                        ascensionResult.hack || 1,
                        ascensionResult.str || 1,
                        ascensionResult.def || 1,
                        ascensionResult.dex || 1,
                        ascensionResult.agi || 1,
                        ascensionResult.cha || 1
                    );
                    
                    ns.gang.ascendMember(member.name);
                    ns.tprint(`🔼 ASCENDED ${member.name} - Max multiplier gain: ${maxGain.toFixed(2)}x`);
                }
            }
            
            // Manage equipment purchases
            const equipmentPurchases = manageEquipment(ns);
            if (equipmentPurchases > 0) {
                ns.tprint(`🛡️ Made ${equipmentPurchases} equipment purchases`);
            }
            
        } catch (error) {
            ns.print(`ERROR: ${error.message}`);
        }
        
        await ns.sleep(30000); // Check every 30 seconds
    }
}