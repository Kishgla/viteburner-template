/** @param {NS} ns */

const WANTED_PENALTY_THRESHOLD = 2; // Start vigilante work if wanted penalty > this
const TRAINING_THRESHOLDS = {
    hacking: 100,  // Train hacking if below this level
    combat: 100    // Train combat if below this level (average of str/def/dex/agi)
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
                    ns.print(`🔼 ASCENDED ${member.name} - Max multiplier gain: ${maxGain.toFixed(2)}x`);
                }
            }
            
        } catch (error) {
            ns.print(`ERROR: ${error.message}`);
        }
        
        await ns.sleep(30000); // Check every 30 seconds
    }
}