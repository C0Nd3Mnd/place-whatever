import { serve } from 'std/http/server.ts'
import { config } from '@/lib/config.ts'
import { imageList } from '@/lib/image.ts'
import { handleRequest } from '@/lib/web.ts'
import { enablePeriodicReporting } from '@/lib/stats.ts'
import { Logger } from '@/lib/logger.ts'

const logger = new Logger('main')

logger.log(`Found ${imageList.length} images.`)

const server = serve({ port: config.webServer.port })

logger.log(`Server started. Listening on port ${config.webServer.port}.`)

if (config.stats.enabled) {
  enablePeriodicReporting()
}

for await (const req of server) {
  handleRequest(req)
}
