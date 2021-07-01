import { serve } from 'std/http/server.ts'
import { Status } from 'std/http/http_status.ts'
import { serveFile } from 'std/http/file_server.ts'
import { config } from '@/lib/config.ts'
import { imageList } from '@/lib/image.ts'
import { pickFromArray } from '@/lib/util.ts'
import { parse, Params } from '@/lib/params.ts'
import { getCached } from '@/lib/cache.ts'

console.log('Launch arguments:', Deno.args)
console.log('Configuration:', config)
console.log('Image list:', imageList)

const server = serve({ port: config.webServer.port })

for await (const req of server) {
  if (req.url === '/favicon.ico') {
    req.respond({
      status: Status.NotFound,
      body: '404: favicon.ico'
    })

    continue
  }

  let params: Params

  try {
    params = parse(req.url)
  } catch (ex) {
    req.respond({
      status: Status.BadRequest,
      body: `403: ${ex.message}`
    })

    continue
  }

  if (!params.width || !params.height) {
    req.respond({
      status: Status.BadRequest,
      body: `403: No image size specified.`
    })

    continue
  }

  const imagePath = await getCached(
    pickFromArray(
      params.category
        ? imageList.filter(image => image.category === params.category)
        : imageList
    ),
    params.width,
    params.height
  )

  const content = await serveFile(req, imagePath)

  if (!content.headers) {
    content.headers = new Headers()
  }

  content.headers.set('Cache-Control', 'no-store')
  req.respond(content)
}
