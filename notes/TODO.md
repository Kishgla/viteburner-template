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
- [ ] Put a target into each prep state, run `test-scripts/prep-id-test.js`, and verify prep IDs use the correct namespace, are shared by grow/weaken prep pairs, and cannot be mistaken for normal batch IDs.
- [x] Re-audit the step 2 testing tasks and test scripts against the completed batch-ID implementation; update them where necessary. ✅ 2026-10-09

### 3. Track in-flight batches

- [x] Persist batch state between scheduler loop iterations.
- [x] Track target, batch ID, operation PIDs, worker hosts, and expected landing time.
- [x] Remove completed or expired batches from tracking.
- [x] Reconcile tracked state with `ns.isRunning()` or `ns.ps()` when necessary.
- [x] Stop relying on failed `ns.exec()` calls as accidental throttling.

Testing:

- [ ] Validate each tracked batch's ID, target, expected landing time, and operation metadata against `ns.ps()`.
- [ ] Let a batch finish and verify its record is removed within a one-second reconciliation window.
- [ ] Kill one process from a multi-process batch and verify the stale PID is removed while live siblings remain tracked.
- [ ] Restart the scheduler while workers are active and verify their batch records are reconstructed before new work is dispatched for those targets.
- [ ] Run a multi-target soak test and confirm tracking stays bounded without appending another full pipeline while prior batches remain active.

### 4. Enforce the pipeline limit

- [ ] Count active batches separately for each target.
- [ ] Schedule only enough batches to reach `PIPELINE`.
- [ ] Maintain a persistent next-landing timestamp for each target.
- [ ] Preserve `CHAIN_SPACER` between consecutive batch landings.
- [ ] Prevent every scheduler loop from recreating a complete pipeline.

Testing:

- [ ] After the step 4 implementation is complete, audit the finished behavior and generate the testing tasks and test scripts needed to validate it.

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

