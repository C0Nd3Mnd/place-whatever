import { config } from '@/lib/config.ts'

function memoryMegabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

export function logReport(): void {
  const { heapUsed, heapTotal, external, rss } = Deno.memoryUsage()

  console.log(
    'Memory summary:',
    `Heap ${memoryMegabytes(heapUsed)}/${memoryMegabytes(heapTotal)} MB`,
    '-',
    `External ${memoryMegabytes(external)} MB`,
    '-',
    `RSS ${memoryMegabytes(rss)} MB`
  )

  console.log(
    'Cache health:',
    `Hit rate ${Math.round(calculateCacheHitrate() * 100)}%`,
    `(of ${cacheHits.length} requests)`
  )
}

let periodicReportingInterval = 0

export function enablePeriodicReporting(): void {
  periodicReportingInterval = setInterval(() => {
    logReport()
  }, config.stats.interval)
}

export function disablePeriodicReporting(): void {
  if (!periodicReportingInterval) {
    return
  }

  clearInterval(periodicReportingInterval)
}

const cacheHits: boolean[] = []

function calculateCacheHitrate(): number {
  if (!cacheHits.length) {
    return 1
  }

  return cacheHits.filter(hit => hit).length / cacheHits.length
}

export function recordCacheHit(hit: boolean): void {
  cacheHits.push(hit)

  while (cacheHits.length > config.stats.cacheHitSize) {
    cacheHits.shift()
  }
}
