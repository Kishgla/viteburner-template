/** @param {NS} ns */

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
 * 	contract location: Silver Helix
 * 	
 * 	HammingCodes: Integer to Encoded Binary
 * 	You are attempting to solve a Coding Contract. You have 10 tries remaining, after which the contract will self-destruct.
 * 	
 * 	
 * 	You are given the following decimal value:
 * 	300
 * 	
 * 	Convert it to a binary representation and encode it as an 'extended Hamming code'.
 * 	The number should be converted to a string of '0' and '1' with no leading zeroes.
 * 	A parity bit is inserted at position 0 and at every position N where N is a power of 2.
 * 	Parity bits are used to make the total number of '1' bits in a given set of data even.
 * 	The parity bit at position 0 considers all bits including parity bits.
 * 	Each parity bit at position 2^N alternately considers 2^N bits then ignores 2^N bits, starting at position 2^N.
 * 	The endianness of the parity bits is reversed compared to the endianness of the data bits:
 * 	Data bits are encoded most significant bit first and the parity bits encoded least significant bit first.
 * 	The parity bit at position 0 is set last.
 * 	
 * 	Examples:
 * 	
 * 	8 in binary is 1000, and encodes to 11110000 (pppdpddd - where p is a parity bit and d is a data bit)
 * 	21 in binary is 10101, and encodes to 1001101011 (pppdpdddpd)
 * 	
 * 	For more information on the 'rule' of encoding, refer to Wikipedia (https://wikipedia.org/wiki/Hamming_code) or the 3Blue1Brown videos on Hamming Codes. (https://youtube.com/watch?v=X8jsijhllIA)
 */

/** HammingCodesIntegerToEncodedBinary
 * 	@param {number} input
 * 	@return {string}
 */
export function hammingCodesIntegerToEncodedBinary(input) {
  const 
  let encodedBits;



  return encodedBits;
}

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

export async function main(ns) {
  const contractTypes = ns.getContractTypes();

  for (const type of contractTypes) {
    ns.tprint(type);
  }
}