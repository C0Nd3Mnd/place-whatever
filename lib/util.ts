export function pickFromArray<T>(arr: T[]): T {
  if (!arr.length) {
    throw new Error('Given array is empty.')
  }

  return arr[random(0, arr.length - 1)]
}

export function random(min: number, max: number): number {
  const range = max - min + 1
  const bytesNeeded = Math.ceil(Math.log2(range) / 8)
  const cutoff = Math.floor((256 ** bytesNeeded) / range) * range
  const bytes = new Uint8Array(bytesNeeded)
  let value
  do {
    crypto.getRandomValues(bytes)
    value = bytes.reduce((acc, x, n) => acc + x * 256 ** n, 0)
  } while (value >= cutoff)
  return min + value % range
}
