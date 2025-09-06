export function hammingCodesIntegerToEncodedBinary(input) {
  let encodedBits;
  return encodedBits;
}
export function subarrayWithMaximumSum(array) {
  let largestSum = -Infinity;
  for (let start = 0; start < array.length; start++) {
    for (let end = start; end < array.length; end++) {
      let subSum = 0;
      for (let current = start; current < end; current++) {
        subSum += array[current];
      }
      if (subSum > largestSum)
        largestSum = subSum;
    }
  }
  return largestSum;
}
export async function main(ns) {
  const contractTypes = ns.getContractTypes();
  for (const type of contractTypes) {
    ns.tprint(type);
  }
}