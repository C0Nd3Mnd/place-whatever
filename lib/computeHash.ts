import { createHash } from 'std/hash/mod.ts'
import { iter } from 'std/io/util.ts'

export async function computeHash(path: string): Promise<string> {
  const handle = await Deno.open(path)
  const hash = createHash('sha256')

  for await (const chunk of iter(handle)) {
    hash.update(chunk)
  }

  return hash.toString()
}
