import { join } from 'std/path/mod.ts'

export const config = {
  webServer: {
    port: 8080
  },
  images: {
    basePath: join(Deno.cwd(), '.imagerepo'),
    sizeLimit: 4000,
    defaultSize: 200,
    extensions: ['jpg', 'jpeg', 'png']
  },
  cache: {
    cachePath: join(Deno.cwd(), '.imagecache')
  }
}
