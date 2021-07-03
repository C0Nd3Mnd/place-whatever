import { walk } from 'std/fs/mod.ts'
import { parse, relative } from 'std/path/mod.ts'
import { config } from '@/lib/config.ts'
import { computeHash } from '@/lib/util.ts'

export interface Image {
  category: string
  path: string
  hash?: string
}

export const imageList: Image[] = []

for await (const { path } of walk(config.image.repository, {
  maxDepth: 2,
  exts: config.image.extensions
})) {
  const { dir } = parse(relative(config.image.repository, path))

  imageList.push({
    category: dir.toLowerCase(),
    path,
    hash: await computeHash(path)
  })
}
