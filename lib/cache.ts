import { config } from '@/lib/config.ts'
import { Image } from '@/lib/image.ts'
import { exists } from 'std/fs/mod.ts'
import { join, parse } from 'std/path/mod.ts'
import { renderSize } from '@/lib/render.ts'
import { recordCacheHit } from '@/lib/stats.ts'
import { Logger } from '@/lib/logger.ts'
import { Performance } from '@/lib/util.ts'

const logger = new Logger('cache')

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

  const imageCacheDir = join(config.cache.path, image.hash)
  const filename = `${width}x${height}${parse(image.path).ext}`

  if (!(await exists(imageCacheDir))) {
    logger.log(
      `Cache directory "${imageCacheDir}" does not exist. Creating it now.`
    )
    await Deno.mkdir(imageCacheDir)
  }

  const fullPath = join(imageCacheDir, filename)

  let cacheHit = true

  if (await exists(fullPath)) {
    logger.log(
      `Using cached version for image ${image.hash}@${width}x${height}`
    )
  } else {
    cacheHit = false
    const perf = new Performance()
    logger.log(`Generating ${image.hash}@${width}x${height}.`)
    const resizedBytes = await renderSize(image.path, width, height)
    await Deno.writeFile(fullPath, resizedBytes)
    logger.log(
      `Generated ${image.hash}@${width}x${height} in ${perf.getFormatted()}`
    )
  }

  recordCacheHit(cacheHit)

  return fullPath
}
