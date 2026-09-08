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
 * Version of the darknet crawler. Used to prevent multiple instances of the crawler from running on the same node.
 * Increment this when deploying a new version of the crawler to ensure that old instances are terminated and replaced with the new version.
 */
const CRAWLER_VERSION = 3;

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
 * Checks if an instance of the crawler is already running on the current node.
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
      await ns.dnet.authenticate(server, "");
      return true;
    default:
      ns.print(`${RED}Unknown model: ${details.modelId}${RESET}`);
      return false;
  }
}

  /**
   * Main function for the darknet crawler. Continuously scans for neighboring nodes, updates the darknet map, and attempts to connect to new nodes.
   * @param {import("@ns").NS} ns 
   * @returns 
   */
  export async function main(ns) {
    const hostname = ns.getHostname();
    if (hostname === "home") {
      await ns.scp(ns.getScriptName(), "darkweb");
      ns.exec(ns.getScriptName(), "darkweb", 1, CRAWLER_VERSION);
      return;
    }

    // If another crawler is already running on this node, 
    const proc = alreadyRunningHere(ns);
    if (proc) {
      const existingVersion = proc.args[0] ?? 0;
      ns.print(`${YELLOW}Prior instance detected.${RESET}`);
      // check its version and terminate it if it's an older version.
      if (existingVersion < CRAWLER_VERSION) {
        ns.kill(proc.pid);
      } else {
        // otherwise, exit this instance of the crawler.
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
        const success = await serverSolver(ns, neighbor);
        if (!success) {
          ns.print(`${RED}Failed to solve server: ${neighbor}${RESET}`);
          continue;
        }

        // copy the crawler onto the new node 
        const success2 = await ns.scp(ns.getScriptName(), neighbor);
        if (!success2) {
          ns.print(`${RED}Failed to copy script to: ${neighbor}${RESET}`);
          continue;
        }
        
        // then execute it
        const pid = ns.exec(ns.getScriptName(), neighbor, 1, CRAWLER_VERSION);
        if (pid === 0) {
          ns.print(`${RED}Failed to execute script on: ${neighbor}${RESET}`);
        } else {
          ns.print(`${GREEN}Successfully executed script on: ${neighbor}${RESET}`);
        }
        

      }




      // check contents of current node 
      // if it has a cache, open it
      // if it has a note with a partial password, read it and store it

      ns.print(`${BLUE}Current node: ${hostname}${RESET}`);
      ns.print(`${BLUE}Sleeping for 3 seconds before next scan...${RESET}`);
      await ns.sleep(3000);
    }
  }