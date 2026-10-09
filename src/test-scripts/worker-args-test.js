const WORKERS = ['hack.js', 'grow.js', 'weaken.js'];
const TEST_DELAY = 60_000;

/** @param {NS} ns */
export async function main(ns) {
  const host = ns.getHostname();
  const target = String(ns.args[0] ?? 'joesguns');

  for (let index = 0; index < WORKERS.length; index++) {
    const worker = WORKERS[index];
    const batchId = `args-test-${Date.now()}-${index}`;
    const expectedArgs = [target, false, TEST_DELAY, batchId];

    if (!ns.fileExists(worker, host)) {
      ns.tprint(`FAIL: ${worker} is not present on ${host}.`);
      continue;
    }

    const pid = ns.exec(worker, host, 1, ...expectedArgs);
    if (pid === 0) {
      ns.tprint(`FAIL: Could not launch ${worker} on ${host}.`);
      continue;
    }

    // Give Bitburner a moment to register the new process before inspecting it.
    await ns.sleep(20);
    const process = ns.ps(host).find((entry) => entry.pid === pid);
    const passed =
      process !== undefined &&
      process.args.length === expectedArgs.length &&
      process.args.every((arg, position) => arg === expectedArgs[position]);

    if (passed) {
      ns.tprint(`PASS: ${worker} args = ${JSON.stringify(process.args)}`);
    } else {
      ns.tprint(
        `FAIL: ${worker} expected ${JSON.stringify(expectedArgs)}, got ${JSON.stringify(
          process?.args ?? null,
        )}`,
      );
    }

    // The worker is still sleeping, so killing it prevents any hack/grow/weaken action.
    ns.kill(pid);
  }
}