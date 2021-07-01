import { ServerRequest, Response } from 'std/http/server.ts'
import { Status } from 'std/http/http_status.ts'
import { serveFile } from 'std/http/file_server.ts'
import { imageList } from '@/lib/image.ts'
import { pickFromArray } from '@/lib/util.ts'
import { parse, Params } from '@/lib/params.ts'
import { getCached } from '@/lib/cache.ts'

async function respondSafe(req: ServerRequest, res: Response): Promise<void> {
  try {
    await req.respond(res)
  } catch (ex) {
    if (ex instanceof Deno.errors.ConnectionAborted) {
      // We can ignore this error.
      return console.warn('ConnectionAborted throw prevented.')
    }

    throw ex
  }
}

export async function handleRequest(req: ServerRequest): Promise<void> {
  if (req.url === '/favicon.ico') {
    req.respond({
      status: Status.NotFound,
      body: '404: favicon.ico'
    })

    return
  }

  let params: Params

  try {
    params = parse(req.url)
  } catch (ex) {
    return respondSafe(req, {
      status: Status.BadRequest,
      body: `403: ${ex.message}`
    })
  }

  if (!params.width || !params.height) {
    return respondSafe(req, {
      status: Status.BadRequest,
      body: `403: No image size specified.`
    })
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

  const res = await serveFile(req, imagePath)

  if (!res.headers) {
    res.headers = new Headers()
  }

  res.headers.set('Cache-Control', 'no-store')
  return respondSafe(req, res)
}
