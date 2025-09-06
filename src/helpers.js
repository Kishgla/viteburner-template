const RED = "\x1B[31m";
const YELLOW = "\x1B[33m";
const RESET = "\x1B[0m";

/**
 * Breadth-first search to discover all servers starting from "home".
 * @param {NS} ns - The Netscript environment.
 * @return {string[]} List of all discovered server names. 
 */
export function getAllServerNames(ns) {
  let queue = ["home"];
  let visited = [];

  while (queue.length > 0) {
    let server = queue.pop();

    if (!visited.includes(server)) {
      visited.push(server);
      ns.print(`Discovered server: ${server}`);

      try {
        const neighbors = ns.scan(server);
        for (const neighbor of neighbors) {
          queue.push(neighbor);
        }
      } catch (err) {
        ns.tprint(`${RED}ERROR scanning ${server}: ${err}${RESET}`);
      }
    }
  }

  ns.print(`Scan complete. Found ${visited.length} servers.`);
  return visited;
}

/**
 * Returns a list of objects containing data for all servers passed in
 * @param {NS} ns - The Netscript environment.
 * @param {string[]} serverNames
 * @param {number} securityBuffer - Additional security buffer above minimum security to trigger weaken
 * @param {number} fundingThreshold - Percentage (0-1) of max money to trigger grow
 * @return {obj[]} serverObjects
 */
export function getServerObjects(ns, serverNames, securityBuffer = 0, fundingThreshold = 0) {
  var serverObjects = [];
  for (const serverName of serverNames) {
    const data = ns.getServer(serverName);
    const obj = {
      name: serverName,
      targetMode: "prep", // "prep" | "farm" (default = "prep")
      stockImpact: null, // "bull" | "bear" | null (default = null)
      lastSeen: Date.now(),
      stockSymbol: null, // placeholder until stock API is put into use
      needsWeaken: data.hackDifficulty > data.minSecurity + securityBuffer,
      needsGrow: data.moneyAvailable < data.moneyMax * fundingThreshold,
      data: data,
      cooldowns: {
        weaken: 0,
        grow: 0,
        hack: 0
      }
    };

    serverObjects.push(obj);
  }

  return serverObjects;
}

export function updateTargetFlags(targets, securityBuffer = 0, fundingThreshold = 0) {
  for (let target of targets) {
    target.needsWeaken = target.data.hackDifficulty > target.data.minDifficulty + securityBuffer;
    target.needsGrow = target.data.moneyAvailable < target.data.moneyMax * fundingThreshold;
    if (!target.needsWeaken && !target.needsGrow) {
      target.targetMode = "farm";
    } else {
      target.targetMode = "prep";
    }
  }
}

export function refreshServers(ns, servers) {
  for (let server of servers) {
    server.data = ns.getServer(server.name);
    server.lastSeen = Date.now();
  }
}

export function countAvailablePortOpeners(ns) {
  let count = 0;
  if (ns.fileExists("BruteSSH.exe", "home")) count++;
  if (ns.fileExists("FTPCrack.exe", "home")) count++;
  if (ns.fileExists("relaySMTP.exe", "home")) count++;
  if (ns.fileExists("HTTPWorm.exe", "home")) count++;
  if (ns.fileExists("SQLInject.exe", "home")) count++;
  return count;
}

export function runAvailablePortOpeners(ns, serverName) {
  if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(serverName);
  if (ns.fileExists("FTPCrack.exe", "home")) ns.ftpcrack(serverName);
  if (ns.fileExists("relaySMTP.exe", "home")) ns.relaysmtp(serverName);
  if (ns.fileExists("HTTPWorm.exe", "home")) ns.httpworm(serverName);
  if (ns.fileExists("SQLInject.exe", "home")) ns.sqlinject(serverName);
}