# Viteburner-template

This is a template for a viteburner project. It is a simple example of how to use Viteburner.

## How to use

Prerequisites: [Node.js](https://nodejs.org/en/download/)

```bash
git clone https://github.com/Tanimodori/viteburner-template.git
cd viteburner-template
npm i
npm run dev
```

In bitburner, select "Options > Remote API", enter the port of viteburner displays (default: `12525`) and click "Connect".

## Dynamic hack scheduler operations

Start the scheduler on `home` with tracking port 20:

```text
run dynamic-hack-scheduler.js 20
```

The launcher replaces an older scheduler version and then becomes the single
network-wide owner. Launching the same version again is safe: it reports the
existing PID and exits. Active worker jobs are left alone when an owner is
replaced, and the replacement reconstructs their tracking state.

Use the script's tail window for a compact status view refreshed every two
seconds. It shows each target's state and pipeline depth, plus the latest
dispatch failure. Port 20 contains the machine-readable snapshot used by the
scripts in `test-scripts/`; it includes batches, prep jobs, target status, and
the latest 50 dispatch attempts.

Stop the owner with `kill dynamic-hack-scheduler.js home`. Existing delayed
workers are intentionally not killed; use `global-killall.js` only when you
also intend to stop all other work. Relaunching the scheduler recovers those
workers and avoids scheduling duplicate prep jobs or full pipelines.

`--test-fail-exec-after=N` is a test-only fault-injection flag. Never use it
for normal scheduling.

Run the complete Part 7 operational test from `home` with:

```text
run test-scripts/part-7-test.js [target] [port=20] [timeout=180000]
```

The test restarts the scheduler, creates a temporary prep condition, applies
RAM pressure, injects one launch failure, and validates singleton recovery. It
removes the fault flag and restores a normal scheduler before it exits.

## API

See [viteburner](https://github.com/Tanimodori/viteburner/blob/main/README.md).

## How to update my clone to the latest version of the template

Usually you only need to upgrade viteburner using npm (or any other package manager you use).

```bash
npm i -D viteburner@latest
```

Or if you want to update all configs:

```bash
# add "upstream" to git remote in case you've overwritten the "origin"
git remote add upstream https://github.com/Tanimodori/viteburner-template.git
# fetch the updates from "upstream"
git fetch upstream
# perform the merge
git merge upstream/main
# NOTE: resolve git conflicts manually now.
# install packages if any gets updated.
npm i
```

## License

[MIT License](LICENSE) © 2022-present Tanimodori
