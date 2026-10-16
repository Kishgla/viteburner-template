/** @param {NS} ns */

// ANSI Colors
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BLUE = "\u001b[34m";
const RESET = "\u001b[0m";

const MAP_FILE = "/darknet-map.txt";
const MAP_HOST = "home";

/**
 * Version of the darknet agent. Used to prevent multiple instances of the agent from running on the same node.
 * Increment this when deploying a new version of the agent to ensure that old instances are terminated and replaced with the new version.
 */
const AGENT_VERSION = 0;

/**
 * Reads the darknet map from the file.
 * @param {import("@ns").NS} ns - The Netscript environment.
 * @returns {Object} - The darknet map.
 */
function readMap(ns) {
  const text = ns.read(MAP_FILE, MAP_HOST);
  if (!text) return {};
  return JSON.parse(text);
}

/**
 * Updates the darknet map file with the current state of the network.
 * @param {import("@ns").NS} ns - The Netscript environment.
 * @param {Object} map - The darknet map to write to the file.
 */
function writeMap(ns, map) {
  ns.write(MAP_FILE, JSON.stringify(map, null, 2), "w");
}

/**
 * Checks if an instance of the agent is already running on the current node.
 * @param {import("@ns").NS} ns - The Netscript environment.
 * @returns {Object|undefined} - The process object if an instance is already running, undefined otherwise.
 */
function alreadyRunningHere(ns) {
  const self = ns.getRunningScript();
  const host = ns.getHostname();

  return ns.ps(host).find((proc) =>
    proc.filename === self.filename &&
    proc.pid !== ns.pid
  );
}

/**
 * Solves the authentication challenge for a given server.
 * @param {import("@ns").NS} ns - The Netscript environment.
 * @param {string} server - The hostname of the server to solve.
 * @returns {Promise<boolean>} - True if the server was solved, false otherwise.
 */
async function serverSolver(ns, server) {
  // read the modelId and hint to identify a guessing strategy for the password
  const details = ns.dnet.getServerDetails(server);
  switch (details.modelId) {
    case "ZeroLogon":
      const result = await ns.dnet.authenticate(server, "");
      if (result.success === false) {
        const log = await ns.dnet.heartbleed(server, { peek: true });
        ns.print(`${YELLOW}Heartbleed log for ${server}: ${log}${RESET}`);
      }
      return result.success;
    case "FreshInstall_1.0":
      // handle known FreshInstall_1.0 authentication cases
      if (details.passwordFormat === "alphabetic") {
        if (details.passwordLength === 8) {
          const result = await ns.dnet.authenticate(server, "password");
        }
      }
      break;
    default:
      ns.print(`${RED}Unknown model: ${details.modelId}${RESET}`);
      return false;
  }
}

/**
 * Main function for the darknet agent. Continuously scans for neighboring nodes, updates the darknet map, and attempts to connect to new nodes.
 * @param {import("@ns").NS} ns 
 * @returns 
 */
export async function main(ns) {
  const hostname = ns.getHostname();
  if (hostname === "home") {
    await ns.scp(ns.getScriptName(), "darkweb");
    ns.exec(ns.getScriptName(), "darkweb", { threads: 1, preventDuplicates: true }, AGENT_VERSION);
    ns.dnet.
    return;
  }

  // If another agent is already running on this node, 
  const proc = alreadyRunningHere(ns);
  if (proc) {
    const existingVersion = proc.args[0] ?? 0;
    ns.print(`${YELLOW}Prior instance detected.${RESET}`);
    // check its version and terminate it if it's an older version.
    if (existingVersion < AGENT_VERSION) {
      ns.kill(proc.pid);
    } else {
      // otherwise, exit this instance of the agent.
      return;
    }
  }

  while (true) {
    // check neighboring nodes for potential new connections
    const neighbors = ns.dnet.probe();

    // maintain a map of the darknet, including last seen time and neighbors
    const map = readMap(ns);
    map[hostname] = {
      lastSeen: Date.now(),
      neighbors,
    };
    writeMap(ns, map);

    // connect to new nodes
    for (const neighbor of neighbors) {
      const details = ns.dnet.getServerDetails(neighbor);
      if (!details.isConnectedToCurrentServer) {
        // if we can't connect to the node, skip it
        continue;
      }

      // if the node is offline, skip it
      if (!details.isOnline) {
        continue;
      }

      // if the agent is already running on this node with the same or newer version, skip it
      const agentIsCurrent = ns.ps(neighbor).some((proc) =>
        proc.filename === ns.getScriptName() &&
        (proc.args[0] ?? 0) >= AGENT_VERSION);
      if (agentIsCurrent) {
        continue;
      }

      // if we don't have a session on the node, try to establish one by attempting the authentication challenge
      if (!details.hasSession) {
        // try to solve the server first
        if (!(await serverSolver(ns, neighbor))) {
          ns.print(`${RED}Failed to solve server: ${neighbor}${RESET}`);
          continue;
        }
      }

      // copy the agent onto the new node 
      if (!(await ns.scp(ns.getScriptName(), neighbor))) {
        ns.print(`${RED}Failed to copy script to: ${neighbor}${RESET}`);
        continue;
      }

      // then execute it
      const pid = ns.exec(ns.getScriptName(), neighbor, { threads: 1, preventDuplicates: true }, AGENT_VERSION);
      if (pid === 0) {
        ns.print(`${RED}Failed to execute script on: ${neighbor}${RESET}`);
      } else {
        ns.print(`${GREEN}Successfully executed script on: ${neighbor}${RESET}`);
      }
    }

    

    // process files on the current host
    const files = ns.ls(ns.getHostname());
    const caches = files.filter(file => file.endsWith('.cache'))[0];
    const readableFiles = files.filter(file => 
      file.endsWith('.txt') ||
      file.endsWith('.lit') ||
      file.endsWith('.msg') ||
      file.endsWith('.json')
    );
    for (const  file of readableFiles) {
      const content = ns.read(file);
      ns.print(`${BLUE}Found readable file: ${file}: ${content}${RESET}`);
    }



    ns.print(`${BLUE}Current node: ${hostname}${RESET}`);
    ns.print(`${BLUE}Sleeping for 5 seconds before next scan...${RESET}`);
    await ns.sleep(5000);
  }
}