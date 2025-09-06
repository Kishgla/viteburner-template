const RED = "\x1B[31m";
const YELLOW = "\x1B[33m";
const RESET = "\x1B[0m";

/**
 * Breadth-first search to discover all servers starting from "home".
 * @param {NS} ns - The Netscript environment.
 * @returns 
 */
export function getAllServerNames(ns) {
  let queue = ["home"];
  let visited = [];
  while (queue.length > 0) {
    let server = queue.pop();
    if (server !== void 0 && !visited.includes(server)) {
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
 * Turns a list of server names into a list of server objects with additional metadata.
 * @param {NS} ns 
 * @param {string[]} serverNames 
 * @param {number} securityBuffer 
 * @param {number} fundingThreshold 
 * @returns 
 */
export function getServerObjects(ns, serverNames, securityBuffer = 0, fundingThreshold = 0) {
  var serverObjects = [];
  for (const serverName of serverNames) {
    const data = ns.getServer(serverName);
    const obj = {
      name: serverName,
      targetMode: "prep",
      // "prep" | "farm" (default = "prep")
      stockImpact: null,
      // "bull" | "bear" | null (default = null)
      lastSeen: Date.now(),
      stockSymbol: null,
      // placeholder until stock API is put into use
      needsWeaken: data.hackDifficulty > data.minSecurity + securityBuffer,
      needsGrow: data.moneyAvailable < data.moneyMax * fundingThreshold,
      data,
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
  if (ns.fileExists("BruteSSH.exe", "home"))
    count++;
  if (ns.fileExists("FTPCrack.exe", "home"))
    count++;
  if (ns.fileExists("relaySMTP.exe", "home"))
    count++;
  if (ns.fileExists("HTTPWorm.exe", "home"))
    count++;
  if (ns.fileExists("SQLInject.exe", "home"))
    count++;
  return count;
}
export function runAvailablePortOpeners(ns, serverName) {
  if (ns.fileExists("BruteSSH.exe", "home"))
    ns.brutessh(serverName);
  if (ns.fileExists("FTPCrack.exe", "home"))
    ns.ftpcrack(serverName);
  if (ns.fileExists("relaySMTP.exe", "home"))
    ns.relaysmtp(serverName);
  if (ns.fileExists("HTTPWorm.exe", "home"))
    ns.httpworm(serverName);
  if (ns.fileExists("SQLInject.exe", "home"))
    ns.sqlinject(serverName);
}