# Project TODO list

## Task dashboard

```tasks
not done
path includes TODO.md
group by heading
```

## Dynamic hack scheduler update - In progress

### 1. Fix and standardize worker scripts - Implementation complete

- [x] Make `hack.js` call `ns.hack()`.
- [x] Make `weaken.js` call `ns.weaken()`.
- [x] Standardize worker arguments as `target`, `stock`, `delay`, `batchId`.
- [x] Update weaken dispatches to include the stock argument placeholder.
- [x] Run lint and syntax checks on the worker scripts.

Testing:

- [x] Run ESLint and JavaScript syntax checks on all three workers.
- [x] Run `test-scripts/worker-contract-test.js` and verify each worker waits for its requested delay, invokes its Netscript action exactly once, and forwards the stock flag correctly where applicable. ✅ 2026-10-09
- [x] Run each worker directly with a short delay as an in-game integration check.
    - [x] `weaken.js`
    - [x] `grow.js`
    - [x] `hack.js`
- [x] Confirm `hack.js`, `grow.js`, and `weaken.js` change the intended server values. ✅ 2026-10-07
- [x] Run `test-scripts/worker-args-test.js` and verify all four positional arguments retain their values and order for every worker. ✅ 2026-10-09
- [x] Start the scheduler with a tracking port, run `test-scripts/batch-order-test.js`, and verify a scheduler-created batch lands in hack, weaken-hack, grow, weaken-grow order within the reported timing tolerance. ✅ 2026-10-09
- [x] Re-audit the step 1 testing tasks and test scripts against the completed worker-script implementation; update them where necessary. ✅ 2026-10-09

### 2. Add unique batch IDs

- [x] Generate one unique ID for each HWGW batch.
- [x] Pass the same ID to all four operations in a batch.
- [x] Give prep operations identifiers that cannot collide with batch operations.
- [x] Confirm split jobs can run on multiple hosts without process-signature collisions.

Testing:

- [x] Start the scheduler with a tracking port, run `test-scripts/batch-id-test.js`, and verify scheduler-created batches use valid unique IDs, share one ID across every HWGW operation, and remain distinguishable on the same host. ✅ 2026-10-09
- [x] Run `test-scripts/batch-id-test.js` with split verification enabled in a RAM-constrained setup and verify every portion of a split operation has the same batch ID and equivalent timing arguments on multiple hosts. ✅ 2026-10-09
- [x] Put a target into each prep state, run `test-scripts/prep-id-test.js`, and verify prep IDs use the correct namespace, are shared by grow/weaken prep pairs, and cannot be mistaken for normal batch IDs. ✅ 2026-10-17
- [x] Re-audit the step 2 testing tasks and test scripts against the completed batch-ID implementation; update them where necessary. ✅ 2026-10-09

### 3. Track in-flight batches

- [x] Persist batch state between scheduler loop iterations.
- [x] Track target, batch ID, operation PIDs, worker hosts, and expected landing time.
- [x] Remove completed or expired batches from tracking.
- [x] Reconcile tracked state with `ns.isRunning()` or `ns.ps()` when necessary.
- [x] Stop relying on failed `ns.exec()` calls as accidental throttling.

Testing:

- [x] Validate each tracked batch's ID, target, expected landing time, and operation metadata against `ns.ps()`. ✅ 2026-10-17
- [x] Let a batch finish and verify its record is removed within a one-second reconciliation window. ✅ 2026-10-17
- [x] Kill one process from a multi-process batch and verify the stale PID is removed while live siblings remain tracked. ✅ 2026-10-17
- [x] Restart the scheduler while workers are active and verify their batch records are reconstructed before new work is dispatched for those targets. ✅ 2026-10-17
- [x] Run a multi-target soak test and confirm tracking stays bounded without appending another full pipeline while prior batches remain active. ✅ 2026-10-17

### 4. Enforce the pipeline limit

- [x] Count active batches separately for each target.
- [x] Schedule only enough batches to reach `PIPELINE`.
- [x] Maintain a persistent next-landing timestamp for each target.
- [x] Preserve `CHAIN_SPACER` between consecutive batch landings.
- [x] Prevent every scheduler loop from recreating a complete pipeline.

Testing:

- [x] After the step 4 implementation is complete, audit the finished behavior and generate the testing tasks and test scripts needed to validate it. ✅ 2026-10-17
- [ ] Run `test-scripts/pipeline-limit-test.js` and verify one target reaches but never exceeds `PIPELINE`, refills while older batch IDs remain active, and maintains at least `CHAIN_SPACER` between tracked landing times.
- [ ] Run `test-scripts/batch-tracking-soak-test.js` for at least five minutes with multiple viable targets and verify every target remains bounded while incremental refills occur.
- [ ] Restart the scheduler with active batches, then rerun `test-scripts/pipeline-limit-test.js` and verify recovered landing times seed a correctly spaced refill without exceeding `PIPELINE`.

### 5. Make batch dispatch atomic

- [ ] Calculate whether enough aggregate RAM exists before launching a batch.
- [ ] Record the thread allocation for every operation and worker.
- [ ] Distinguish complete, partial, and failed dispatches.
- [ ] Avoid launching an incomplete batch where practical.
- [ ] Define safe cleanup or recovery behavior after a partial launch.

Testing:

- [ ] After the step 5 implementation is complete, audit the finished behavior and generate the testing tasks and test scripts needed to validate it.

### 6. Improve preparation tracking

- [ ] Track prep work that is already in flight for each target.
- [ ] Prevent duplicate grow and weaken prep jobs.
- [ ] Wait for scheduled prep work to land before reevaluating server state.
- [ ] Transition cleanly from preparation to batching.
- [ ] Handle targets that fall out of their prepared state during batching.

Testing:

- [ ] After the step 6 implementation is complete, audit the finished behavior and generate the testing tasks and test scripts needed to validate it.

### 7. Add operational visibility

- [ ] Log batch IDs, targets, landing times, and thread allocations.
- [ ] Show active pipeline depth per target.
- [ ] Report incomplete dispatches and failed worker launches clearly.
- [ ] Add a concise status view without flooding the script log.
- [ ] Document how to start, monitor, and stop the scheduler safely.

Testing:

- [ ] After the step 7 implementation is complete, audit the finished behavior and generate the testing tasks and test scripts needed to validate it.

## Darknet agent update

### Implement file processing

- [ ] Define the supported purpose and handling rules for `.cache`, `.txt`, `.lit`, `.msg`, and `.json` files.
- [ ] Replace the unused single-cache lookup with processing for every relevant file on the host.
- [ ] Parse structured files safely and preserve raw content when parsing fails.
- [ ] Extract authentication clues, credentials, model information, and other actionable data.
- [ ] Store processed-file metadata so unchanged files are not reread and logged every loop.
- [ ] Associate discovered information with the source host in the darknet map.
- [ ] Decide which files or extracted results should be copied back to `home`.
- [ ] Add concise logging for new information, parse failures, and skipped files.
- [ ] Ensure processing never overwrites or deletes discovered files.

Testing:

- [ ] Test every supported extension with representative content.
- [ ] Test malformed, empty, duplicate, and unexpectedly large files.
- [ ] Confirm multiple `.cache` files on one host are all handled.
- [ ] Confirm unchanged files are not repeatedly processed or logged.
- [ ] Confirm changed files are detected and reprocessed.
- [ ] Verify extracted data is attributed to the correct host and survives map updates.
- [ ] Verify file-processing failures do not stop scanning or agent propagation.

### Extend the server solver

- [ ] Step 1: Capture representative `getServerDetails()` results for every known server model and authentication challenge.
- [ ] Step 2: Define a solver-result structure containing success, attempted strategy, retry eligibility, and diagnostic context.
- [ ] Step 3: Refactor authentication strategies into a registry keyed by model ID instead of expanding one switch statement.
- [ ] Step 4: Complete and validate the `ZeroLogon` strategy, including the Heartbleed clue path.
- [ ] Step 5: Complete `FreshInstall_1.0` handling for known password formats and lengths without hard-coding one unchecked attempt.
- [ ] Step 6: Feed credentials and clues discovered by file processing into applicable solver strategies.
- [ ] Step 7: Add bounded retries and backoff so unsolved servers are not attacked every scan loop.
- [ ] Step 8: Record solver attempts and outcomes in the darknet map for use by other agents.
- [ ] Step 9: Add a safe fallback for unknown models that records details without wasting authentication attempts.
- [ ] Step 10: Document how to add and test another server-model strategy.

Testing:

- [ ] Unit-test each strategy with captured server-detail and clue fixtures.
- [ ] Verify successful authentication returns `true` and permits agent deployment.
- [ ] Verify failed authentication returns `false` with useful diagnostic state.
- [ ] Confirm clues from files and Heartbleed are passed to the correct strategy.
- [ ] Confirm retry limits and backoff prevent repeated attempts on every loop.
- [ ] Confirm unknown models are recorded once and do not crash the agent.
- [ ] Run an in-game traversal test across multiple model types.
- [ ] Verify concurrent agents do not duplicate expensive solver attempts unnecessarily.

## Matrix terminal background

Scope: `src/lib/matrix-bg.js` and its `getopts` dependency.

### Correctness and integration

- [x] Resolve the `getops.js`/`getopts.js` filename mismatch so `matrix-bg.js` can load its parser. ✅ 2026-10-17
- [x] Preserve `rainbow: false` during option normalization so rainbow mode is genuinely off by default. ✅ 2026-10-17
- [x] Validate the original numeric values as finite integers instead of validating `Math.floor(value)`. ✅ 2026-10-17
- [x] Accept every integer color offset, normalize it modulo 360, and make validation and help text agree. ✅ 2026-10-17
- [x] Repair the mojibake by using ASCII `deg` in logs and a Unicode escape for the initial Katakana character. ✅ 2026-10-17
- [x] Replace implicit global `sprintf` calls with template literals. ✅ 2026-10-17
- [x] Use `tprint` for raw help and status text so literal percent signs are not parsed as `sprintf` placeholders. ✅ 2026-10-17
- [x] Avoid Bitburner's reserved `run -t` thread flag by using `-l, --log` for the renderer log. ✅ 2026-10-17
- [x] Make cleanup idempotent and remove only DOM elements owned by the current instance. ✅ 2026-10-17

### Relaunchable singleton

- [x] Implement a singleton controller that works across separate Bitburner script processes rather than relying on the module-local `running` variable. ✅ 2026-10-17
- [x] Store ownership and live configuration in a documented shared-window registry. ✅ 2026-10-17
- [x] Have the first instance claim ownership and continue rendering. ✅ 2026-10-17
- [x] When the script is launched again, send the newly parsed options to the active owner and exit the new process cleanly. ✅ 2026-10-17
- [x] Make the active owner consume configuration changes and update delay, hue, blur, opacity, random color, and rainbow behavior without recreating duplicate canvases. ✅ 2026-10-17
- [x] Include an instance token and PID in the registry so stale state cannot impersonate a live owner. ✅ 2026-10-17
- [x] Version the singleton protocol and automatically replace an older owner after renderer code changes. ✅ 2026-10-17
- [x] Detect a stale owner record, clear it safely, and allow a new instance to take ownership. ✅ 2026-10-17
- [x] Release singleton state during `ns.atExit()` without clearing ownership that belongs to a replacement instance. ✅ 2026-10-17
- [x] Define predictable behavior for simultaneous launches so exactly one renderer remains active. ✅ 2026-10-17
- [x] Add a `--stop` option that asks the active owner to clean up and exit without requiring a manual `kill` command. ✅ 2026-10-17

### Rendering and UI resilience

- [x] Give every rain drop an independent hue selected from a range around the configured base hue. ✅ 2026-10-17
- [x] Move rainbow color cycling from a canvas-wide CSS filter into per-drop rendering while retaining each drop's independent color phase. ✅ 2026-10-17
- [x] Add a live-configurable `--spread` option from 0-360 degrees, including a zero-width single-color mode. ✅ 2026-10-17
- [x] Establish an isolated stacking context and transparent terminal layer so the canvas renders behind terminal content. ✅ 2026-10-17
- [x] Size the canvas from the current terminal container instead of `window.screen`. ✅ 2026-10-17
- [x] Recalculate canvas dimensions and column count when the window or terminal layout changes. ✅ 2026-10-17
- [x] Replace the fixed 256-column count and hard-coded vertical reset value with values derived from canvas dimensions and character size. ✅ 2026-10-17
- [x] Preserve blur while rainbow hue animation is active. ✅ 2026-10-17
- [x] Set an explicit font, font size, text baseline, and device-pixel-ratio strategy for consistent rendering. ✅ 2026-10-17
- [x] Pause or reduce drawing work while the terminal is hidden, and resume when it becomes visible. ✅ 2026-10-17
- [x] Add `--no-pause` to keep the canvas mounted and drawing when the browser tab is hidden or navigation removes the terminal node. ✅ 2026-10-18
- [x] Add `-i`/`--init-color` so the first drop in each newly created column uses a fixed hue before reverting to normal color behavior on reset. ✅ 2026-10-18
- [x] Handle a missing or replaced terminal DOM node without leaving a stale canvas behind. ✅ 2026-10-17
- [x] Restore any terminal attributes or styles changed by the script during cleanup. ✅ 2026-10-17
- [x] Observe new terminal output and assign status colors to drops born during `ERROR:`, `FAIL:`, `WARN:`, `WARNING:`, and `INFO:` windows, retaining each color until that drop resets. ✅ 2026-10-18

### Maintainability and user experience

- [x] Separate option parsing, validation, rendering, DOM lifecycle, and singleton messaging into focused functions. ✅ 2026-10-17
- [x] Derive aliases, defaults, and parser types from one option-definition source. ✅ 2026-10-17
- [x] Document that direct DOM access depends on Bitburner UI internals and may require maintenance after game updates. ✅ 2026-10-17
- [x] Add concise startup, live-reconfiguration, stop, and recovery messages without logging every animation frame. ✅ 2026-10-17
- [x] Document example commands for default, fixed-color, random-color, rainbow, reconfiguration, and stop behavior in `--help`. ✅ 2026-10-17

Testing:

- [x] Run lint and syntax checks on `matrix-bg.js` and `getops.js`. ✅ 2026-10-17
- [x] Run `--help`; verify every short and long option, accepted range, default, example, and terminal-DOM warning is accurate. ✅ 2026-10-17
- [x] Run with `-l` and `--log`; verify Bitburner accepts both forms and opens the persistent owner's log without creating another renderer. ✅ 2026-10-17
- [x] Launch with no arguments; verify the canvas is behind the terminal, the log reports rainbow off, and the default values are delay 33, hue 0, opacity 25, blur 0, and spread 0. ✅ 2026-10-17
- [x] Test `-b N` and `--blur N`; verify both apply the same blur value. ✅ 2026-10-17
- [x] Test `-c DEG` and `--color DEG`; verify both apply the same hue offset. ✅ 2026-10-17
- [x] Test `-d MS` and `--delay MS`; verify both apply the same frame delay. ✅ 2026-10-17
- [x] Test `-o PCT` and `--opacity PCT`; verify both apply the same opacity. ✅ 2026-10-17
- [x] Test `-R SEC` and `--rainbow SEC`; verify both apply the same rainbow duration. ✅ 2026-10-17
- [x] Test `-S DEG` and `--spread DEG`; verify both apply the same color range. ✅ 2026-10-17
- [ ] Test `-i DEG` and `--init-color DEG`; verify both give every newly created column the same first-drop hue.
- [x] Test `--rainbow` with no duration and verify it uses 10 seconds; then test explicit durations of 1 and 100 seconds. ✅ 2026-10-17
- [x] Verify invalid numeric input is rejected: empty values, decimals, `NaN`, `Infinity`, booleans, and values just outside each documented range. ✅ 2026-10-17
- [x] Verify negative and greater-than-359 color offsets wrap correctly, including `--color -120`, `--color 360`, and `--color 480`. ✅ 2026-10-17
- [x] Verify unexpected positional arguments and unknown flags print a useful error and help text without creating a canvas. ✅ 2026-10-17
- [x] Verify `--random` selects a valid hue and overrides an accompanying `--color` value. ✅ 2026-10-17
- [x] Verify simultaneous drops use visibly different hues and a respawned drop receives a new hue. ✅ 2026-10-17
- [x] Compare `--spread 0`, `--spread 60`, `--spread 120`, and `--spread 360`; verify zero is single-color and larger values increase variety. ✅ 2026-10-17
- [x] Run with `--rainbow 10`; verify drops retain separate color phases, complete a cycle in about ten seconds, and preserve the configured blur. ✅ 2026-10-17
- [x] Relaunch with different color, spread, delay, opacity, blur, and rainbow values; verify the original PID applies all changes without adding another persistent process, canvas, or stylesheet. ✅ 2026-10-17
- [x] Launch multiple configurations nearly simultaneously; verify exactly one renderer owns the shared registry and remains active. ✅ 2026-10-17
- [x] Start an older protocol version or inject stale ownership state, then relaunch and verify the incompatible or stale owner is replaced safely. ✅ 2026-10-17
- [x] Use `--stop`; verify the owner exits and removes its canvas, stylesheet, container marker, observer, and shared registry state. ✅ 2026-10-17
- [x] Resize the game window horizontally and vertically; verify canvas pixels remain sharp, dimensions track the terminal, and columns are added or removed without gaps. ✅ 2026-10-17
- [x] Change browser zoom or move between displays with different scaling; verify device-pixel-ratio resizing keeps text sharp and correctly sized. ✅ 2026-10-17
- [x] Navigate away from the terminal; verify drawing pauses and its canvas detaches, then return and verify a single correctly sized canvas reattaches and rendering resumes. ✅ 2026-10-17
- [x] Leave the browser tab hidden for at least one minute; verify animation work remains paused and resumes without a burst or duplicated renderer. ✅ 2026-10-17
- [ ] Relaunch with `--no-pause`, visit several non-terminal menus, hide and restore the browser tab, and verify the canvas remains mounted and rendering advances continuously without creating another renderer.
- [ ] Relaunch without `--no-pause`, hide and restore the browser tab, and verify the default pause behavior still works.
- [x] Test normal `--stop`, manual PID kill, script error, stale-owner recovery, and terminal DOM replacement; verify each path leaves no unintended DOM markers or elements. ✅ 2026-10-17
- [x] Run a 30-minute soak test while resizing, navigating, and live-reconfiguring; verify bounded memory usage, one owner, one canvas, and no repeated log noise. ✅ 2026-10-17
- [x] Smoke-test against the current Bitburner release and record the terminal selector and wrapper hierarchy observed during the test. ✅ 2026-10-17
- [ ] Display an `INFO:` terminal message; verify only drops born during the response window become blue and retain blue until they reset.
- [ ] Display a `WARN:` terminal message; verify only drops born during the response window become yellow and retain yellow until they reset.
- [ ] Display a `WARNING:` terminal message; verify it behaves identically to `WARN:`.
- [ ] Display an `ERROR:` terminal message; verify only drops born during the response window become red and retain red until they reset.
- [ ] Display a `FAIL:` terminal message; verify it behaves identically to `ERROR:`.
- [ ] Display INFO, WARN, and ERROR messages in quick succession; verify the highest active severity wins and lower-severity output does not interrupt it.
- [ ] Enable rainbow mode, trigger each status type, and verify status-colored drops remain fixed at their assigned hue until reset while ordinary drops continue cycling.
- [ ] Navigate away from and back to the terminal after a status flash; verify the output observer reconnects once without replaying old messages.
- [ ] Relaunch or reattach with `--init-color 240`; verify the initial sweep is red and each column switches to the configured palette only after its first reset.
- [ ] Combine `--init-color`, `--spread`, and `--rainbow`; verify initial drops stay fixed until reset and later drops follow spread and rainbow settings.
- [ ] Trigger a status message while columns are being created; verify the status hue takes priority over `--init-color` for those columns.

## General script review

For each script, review correctness, argument handling, error handling, RAM usage,
logging, infinite-loop pacing, interactions with other scripts, and stale or
duplicated behavior.

Per-script testing procedure:

- [ ] Run lint and syntax checks for the script under review.
- [ ] Exercise normal behavior with representative game state and arguments.
- [ ] Exercise missing prerequisites, invalid arguments, and low-RAM conditions where applicable.
- [ ] Check logs and terminal output for actionable errors without excessive repetition.
- [ ] Confirm starting and stopping the script does not leave unintended processes or state.
- [ ] Record any script-specific test cases alongside the review findings.

- [ ] Code review - `ANSI-tail-test.js`
- [ ] Bitburner 3.0.0 compatibility - `ANSI-tail-test.js`
- [ ] Code review - `automate.js`
- [ ] Bitburner 3.0.0 compatibility - `automate.js`
- [ ] Code review - `buyBack.js`
- [ ] Bitburner 3.0.0 compatibility - `buyBack.js`
- [ ] Code review - `check_karma.js`
- [ ] Bitburner 3.0.0 compatibility - `check_karma.js`
- [ ] Code review - `connection-path.js`
- [ ] Bitburner 3.0.0 compatibility - `connection-path.js`
- [ ] Code review - `contract-solvers.js`
- [ ] Bitburner 3.0.0 compatibility - `contract-solvers.js`
- [ ] Code review - `corp-automator.js`
- [ ] Bitburner 3.0.0 compatibility - `corp-automator.js`
- [ ] Code review - `darknet-agent.js`
- [ ] Bitburner 3.0.0 compatibility - `darknet-agent.js`
- [ ] Code review - `dynamic-hack-scheduler.js`
- [ ] Bitburner 3.0.0 compatibility - `dynamic-hack-scheduler.js`
- [ ] Code review - `gang-manager.js`
- [ ] Bitburner 3.0.0 compatibility - `gang-manager.js`
- [ ] Code review - `global-killall.js`
- [ ] Bitburner 3.0.0 compatibility - `global-killall.js`
- [ ] Code review - `grow.js`
- [ ] Bitburner 3.0.0 compatibility - `grow.js`
- [ ] Code review - `hack.js`
- [ ] Bitburner 3.0.0 compatibility - `hack.js`
- [ ] Code review - `hacknet-automator.js`
- [ ] Bitburner 3.0.0 compatibility - `hacknet-automator.js`
- [ ] Code review - `helpers.js`
- [ ] Bitburner 3.0.0 compatibility - `helpers.js`
- [ ] Code review - `joesguns-xp.js`
- [ ] Bitburner 3.0.0 compatibility - `joesguns-xp.js`
- [ ] Code review - `joesguns-weaken.js`
- [ ] Bitburner 3.0.0 compatibility - `joesguns-weaken.js`
- [ ] Code review - `message-test.js`
- [ ] Bitburner 3.0.0 compatibility - `message-test.js`
- [ ] Code review - `playGo.js`
- [ ] Bitburner 3.0.0 compatibility - `playGo.js`
- [ ] Code review - `purchase-servers.js`
- [ ] Bitburner 3.0.0 compatibility - `purchase-servers.js`
- [ ] Code review - `share.js`
- [ ] Bitburner 3.0.0 compatibility - `share.js`
- [ ] Code review - `shareRam.js`
- [ ] Bitburner 3.0.0 compatibility - `shareRam.js`
- [ ] Code review - `Stock-trader.js`
- [ ] Bitburner 3.0.0 compatibility - `Stock-trader.js`
- [ ] Code review - `template.js`
- [ ] Bitburner 3.0.0 compatibility - `template.js`
- [ ] Code review - `weaken.js`
- [ ] Bitburner 3.0.0 compatibility - `weaken.js`
- [ ] Code review - `worker-test.js`
- [ ] Bitburner 3.0.0 compatibility - `worker-test.js`

## Bitburner 3.0.0 compatibility review criteria

- [ ] Compare every Netscript API call with the Bitburner 3.0.0 definitions.
- [ ] Check changed method signatures, option objects, return values, and async behavior.
- [ ] Check renamed, removed, deprecated, or newly singularity-gated APIs.
- [ ] Verify script paths, imports, `scp`, and remote `exec` behavior.
- [ ] Verify all worker argument positions and process-identity assumptions.
- [ ] Check RAM-cost-sensitive APIs and ensure scripts have enough host RAM.
- [ ] Run ESLint and syntax validation across all scripts.
- [ ] Perform in-game smoke tests for scripts that depend on live game state.
- [ ] Record any required migration changes before implementing them.

