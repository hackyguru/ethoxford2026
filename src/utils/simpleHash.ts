export function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    hash = hash & 0xFFFFFFFF; // Keep it 32-bit
  }
  return Math.abs(hash); // Positive integer
}
