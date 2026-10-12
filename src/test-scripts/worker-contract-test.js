import { main as runGrow } from '../grow.js';
import { main as runHack } from '../hack.js';
import { main as runWeaken } from '../weaken.js';

const DELAY = 25;
const BATCH_ID = 'worker-contract-test';

/** Deterministically test worker argument handling without changing a server. @param {NS} ns */
export async function main(ns) {
  const cases = [
    { name: 'hack false', worker: runHack, action: 'hack', stock: false },
    { name: 'hack true', worker: runHack, action: 'hack', stock: true },
    { name: 'grow false', worker: runGrow, action: 'grow', stock: false },
    { name: 'grow true', worker: runGrow, action: 'grow', stock: true },
    { name: 'weaken placeholder', worker: runWeaken, action: 'weaken', stock: true },
  ];
  let failures = 0;

  for (const test of cases) {
    const calls = [];
    await test.worker(makeNs(test.stock, calls));
    const sleepCalls = calls.filter((call) => call.name === 'sleep');
    const actionCalls = calls.filter((call) => call.name === test.action);
    const sleepBeforeAction = calls.findIndex((call) => call.name === 'sleep') < calls.findIndex((call) => call.name === test.action);
    const stockCorrect = test.action === 'weaken' || actionCalls[0]?.options?.stock === test.stock;
    const passed = sleepCalls.length === 1
      && sleepCalls[0].delay === DELAY
      && actionCalls.length === 1
      && actionCalls[0].target === 'n00dles'
      && sleepBeforeAction
      && stockCorrect;
    if (!passed) failures += 1;
    ns.tprint(`${passed ? 'PASS' : 'FAIL'}: ${test.name} calls=${JSON.stringify(calls)}`);
  }

  ns.tprint(`${failures === 0 ? 'PASS' : 'FAIL'}: ${cases.length - failures}/${cases.length} worker contracts passed.`);
}

function makeNs(stock, calls) {
  const args = ['n00dles', stock, DELAY, BATCH_ID];
  return {
    args,
    flags: () => ({ _: args, debug: false }),
    sleep: async (delay) => { calls.push({ name: 'sleep', delay }); },
    hack: async (target, options) => { calls.push({ name: 'hack', target, options }); return 1; },
    grow: async (target, options) => { calls.push({ name: 'grow', target, options }); return 1; },
    weaken: async (target) => { calls.push({ name: 'weaken', target }); return 1; },
  };
}
