/** @param {NS} ns */

//ANSI colors
const red = "\u001b[31m";
const reset = "\u001b[0m";

function getAllServerNames(ns) {
  var queue = ["home"];
  var visited = [];

  while (queue.length > 0) {
    var server = queue.pop();

    if (!visited.includes(server)) {
      visited.push(server);
      ns.print(`Discovered server: ${server}`);

      try {
        const neighbors = ns.scan(server);
        for (const neighbor of neighbors) {
          queue.push(neighbor);
        }
      } catch (err) {
        ns.tprint(`${red}ERROR scanning ${server}: ${err}${reset}`);
      }
    }
  }

  ns.print(`Scan complete. Found ${visited.length} servers.`);
  return visited.reverse();
}

export async function main(ns) {
  const servers = getAllServerNames(ns);
  for (const server of servers) {
    ns.print(`killing scripts on ${server}`);
    try {
      ns.killall(server);
    } catch (err) {
      ns.print(`${red}ERROR invalid server name: ${server}${reset}`);
    }
  }
}