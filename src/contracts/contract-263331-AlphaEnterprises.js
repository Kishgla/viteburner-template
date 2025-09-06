/** @param {NS} ns */
//Given the following integer array, find the contiguous subarray (containing at least one number) which has the largest sum and return that sum. 'Sum' refers to the sum of all the numbers in the subarray.
//-2,-7,-6,-2,10,-5,-10,-4,-5,10,-5,-8,-4,-10,6,0,-2,4,-9,-9,-4,8,7,-6,5,-2,-10,-2,-4,-7,8,7,7,-8,-10,-3,-2,-2,6,0
export async function main(ns) {
  const array = [-2, -7, -6, -2, 10, -5, -10, -4, -5, 10, -5, -8, -4, -10, 6, 0, -2, 4, -9, -9, -4, 8, 7, -6, 5, -2, -10, -2, -4, -7, 8, 7, 7, -8, -10, -3, -2, -2, 6, 0];
  let largestSum = -Infinity;

  for (let start = 0; start < array.length; start++) {
    for (let end = start; end < array.length; end++) {
      let subSum = 0;
      for (let current = start; current < end; current++) {
        subSum += array[current];
      }
      if (subSum > largestSum) largestSum = subSum;
    }
  }
  //ns.tprint(`Largest sum = ${largestSum}`);
  return largestSum;
}