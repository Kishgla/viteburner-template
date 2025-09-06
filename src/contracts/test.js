/** @param {NS} ns */
import {contiguousSubarrayLargestSum} from "contracts/contract-solvers.js";

export async function main(ns) {
  const array = [-2, -7, -6, -2, 10, -5, -10, -4, -5, 10, -5, -8, -4, -10, 6, 0, -2, 4, -9, -9, -4, 8, 7, -6, 5, -2, -10, -2, -4, -7, 8, 7, 7, -8, -10, -3, -2, -2, 6, 0];

  const result = contiguousSubarrayLargestSum(array);

  ns.tprint(`Largest sum = ${result}`);
}