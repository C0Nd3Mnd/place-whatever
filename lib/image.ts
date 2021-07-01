import { walk } from 'std/fs/mod.ts'
import { parse, relative } from 'std/path/mod.ts'
import { config } from '@/lib/config.ts'
import { computeHash } from '@/lib/computeHash.ts'

export interface Image {
  category: string
  path: string
  hash?: string
}

export const imageList: Image[] = []

for await (const { path } of walk(config.images.basePath, {
  maxDepth: 2,
  exts: config.images.extensions
})) {
  const { dir } = parse(relative(config.images.basePath, path))

  imageList.push({
    category: dir.toLowerCase(),
    path,
    hash: await computeHash(path)
  })
}
