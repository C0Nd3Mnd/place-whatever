import { config } from '@/lib/config.ts'
import { Image } from '@/lib/image.ts'
import { exists } from 'std/fs/mod.ts'
import { join, parse } from 'std/path/mod.ts'
import { renderSize } from '@/lib/render.ts'
import { recordCacheHit } from '@/lib/stats.ts'

let initialized = false
let initializing = false

async function init() {
  if (initialized || initializing) {
    return
  }

  initializing = true

  await Deno.mkdir(config.cache.path, { recursive: true })

  initializing = false
  initialized = true
}

export async function getCached(
  image: Image,
  width: number,
  height: number
): Promise<string> {
  await init()

  if (!image.hash) {
    throw new Error('Image has no hash!')
  }

  console.log(image.hash)

  const imageCacheDir = join(config.cache.path, image.hash)
  const filename = `${width}x${height}${parse(image.path).ext}`

  if (!(await exists(imageCacheDir))) {
    console.log(imageCacheDir)
    await Deno.mkdir(imageCacheDir)
  }

  const fullPath = join(imageCacheDir, filename)

  let cacheHit = true

  if (!(await exists(fullPath))) {
    cacheHit = false
    const resizedBytes = await renderSize(image.path, width, height)
    await Deno.writeFile(fullPath, resizedBytes)
  }

  recordCacheHit(cacheHit)

  return fullPath
}
