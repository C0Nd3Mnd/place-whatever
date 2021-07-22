import { walk } from 'std/fs/mod.ts'
import { parse, relative, join } from 'std/path/mod.ts'
import { config } from '@/lib/config.ts'
import { computeHash } from '@/lib/util.ts'

export interface Image {
  category: string
  path: string
  hash?: string
}

export const imageList: Image[] = []

async function addToImageList(category: string, path: string): Promise<void> {
  if (imageList.find(image => image.path === path)) {
    return console.warn(`Skipping already added image "${path}".`)
  }

  try {
    imageList.push({
      category: category.toLowerCase(),
      path,
      hash: await computeHash(path)
    })
  } catch (ex) {
    console.warn(`Error trying to add image "${path}. Skipping."`, ex)
  }
}

function removeFromImageList(path: string): void {
  const image = imageList.find(image => image.path === path)

  if (!image) {
    return
  }

  imageList.splice(imageList.indexOf(image), 1)

  console.log(`Removed image "${path}".`)
}

for await (const { path } of walk(config.image.repository, {
  maxDepth: 2,
  exts: config.image.extensions
})) {
  const { dir } = parse(relative(config.image.repository, path))

  await addToImageList(dir, path)
}

async function watchDirectory() {
  const watcher = Deno.watchFs(config.image.repository, { recursive: true })

  for await (const { kind, paths } of watcher) {
    switch (kind) {
      case 'create':
      case 'modify':
        for (const path of paths) {
          const { ext, dir } = parse(
            relative(config.image.repository, path)
          )

          if (!config.image.extensions.includes(ext.substr(1))) {
            continue
          }

          await addToImageList(dir, path)
        }
        break
      case 'remove':
        for (const path of paths) {
          removeFromImageList(path)
        }
        break
    }
  }
}

watchDirectory()
