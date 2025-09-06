// Registry of coding contract solvers

/** Map of contract types to solver functions */
export const SOLVERS = Object.freeze({
  "SubarrayWithMaximumSum": subarrayWithMaximumSum
});

/** Utility to check if we have a solver for the given type */
export function hasSolver(type) {
  return type in SOLVERS;
}

/** Utility to run the solver for the given type and data */
export async function solveContract(type, data) {
  const solver = SOLVERS[type];
  if (typeof solver !== "function") {return null;}
  try {
    return await solver(data);
  } catch (err) {
    ns.print(`Error running solver for ${type}: ${err}`);
    return null;
  }
}

/** AlgorithmicStockTraderI
 * 	@param
 * 	@return
 */

/** AlgorithmicStockTraderII
 * 	@param
 * 	@return
 */

/** AlgorithmicStockTraderIII
 * 	@param
 * 	@return
 */

/** AlgorithmicStockTraderIV
 * 	@param
 * 	@return
 */

/** ArrayJumpingGame
 * 	@param
 * 	@return
 */

/** ArrayJumpingGameII
 * 	@param
 * 	@return
 */

/** CompressionIIILZCompression
 * 	@param
 * 	@return
 */

/** CompressionIILZDecompression
 * 	@param
 * 	@return
 */

/** CompressionIRLECompression
 * 	@param
 * 	@return
 */

/** EncryptionICaesarCipher
 * 	@param
 * 	@return
 */

/** EncryptionIIVigenereCipher
 * 	@param
 * 	@return
 */

/** FindAllValidMathExpressions
 * 	@param
 * 	@return
 */

/** FindLargestPrimeFactor
 * 	@param
 * 	@return
 */

/** GenerateIPAddresses
 * 	@param
 * 	@return
 */

/** HammingCodesEncodedBinaryToInteger
 * 	@param
 * 	@return
 */

/** HammingCodesIntegerToEncodedBinary
 * 	@param {number} input
 * 	@return {string}
 */

/** MergeOverlappingIntervals
 * 	@param
 * 	@return
 */

/** MinimumPathSumInATriangle
 * 	@param
 * 	@return
 */

/** Proper2ColoringOfAGraph
 * 	@param
 * 	@return
 */

/** SanitizeParenthesesInExpression
 * 	@param
 * 	@return
 */

/** ShortestPathInAGrid
 * 	@param
 * 	@return
 */

/** SpiralizeMatrix
 * 	@param
 * 	@return
 */

/** SquareRoot
 * 	@param
 * 	@return
 */

/** SubarrayWithMaximumSum
 * 	@param {number[]} array
 * 	@return {number} largestSum
 */
export function subarrayWithMaximumSum(array) {
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

/** TotalWaysToSum
 * 	@param
 * 	@return
 */

/** TotalWaysToSumII
 * 	@param
 * 	@return
 */

/** UniquePathsInAGridI
 * 	@param
 * 	@return
 */

/** UniquePathsInAGridII
 * 	@param
 * 	@return
 */
