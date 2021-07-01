import { serve } from 'std/http/server.ts'
import { config } from '@/lib/config.ts'
import { imageList } from '@/lib/image.ts'
import { handleRequest } from '@/lib/web.ts'

console.log('Launch arguments:', Deno.args)
console.log('Configuration:', config)
console.log('Image list:', imageList)

const server = serve({ port: config.webServer.port })

for await (const req of server) {
  handleRequest(req)
}
