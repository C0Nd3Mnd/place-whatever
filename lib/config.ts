import { join, resolve } from 'std/path/mod.ts'

/**
 * Configuration tree.
 */
export const config = {
  /**
   * Webserver configuration.
   */
  webServer: {
    /**
     * Webserver listen port.
     */
    port: 8080
  },
  /**
   * Image configuration.
   */
  image: {
    /**
     * Path where all images are stored.
     */
    repository: join(Deno.cwd(), '.imagerepo'),
    /**
     * Size limit per dimension (in pixels).
     */
    sizeLimit: 4000,
    /**
     * Default size (if no size is given).
     */
    defaultSize: 200,
    /**
     * Allowed extensions.
     */
    extensions: ['jpg', 'jpeg', 'png']
  },
  /**
   * Cache configuration.
   */
  cache: {
    /**
     * Path where the cache should be stored. Must be writable. Will be created
     * if it does not exist.
     */
    path: join(Deno.cwd(), '.imagecache')
  },
  /**
   * Render (resize/crop) configuration.
   */
  render: {
    /**
     * Quality level to use for generated JPG files.
     */
    jpgQuality: 85,
    /**
     * Compression level to use for generated PNG files.
     *
     * @todo Allow value 0 via environment.
     */
    pngCompression: 3
  },
  /**
   * Statistic logging configuration.
   */
  stats: {
    /**
     * Enable periodic logging of statistics.
     */
    enabled: true,
    /**
     * Periodic logging interval in ms.
     */
    interval: 60000,
    /**
     * Amount of requests the cache hit rate is based upon.
     */
    cacheHitSize: 100
  }
}


;(() => {
  const env = Deno.env.toObject()

  if (env.WEBSERVER_PORT) {
    const parsed = parseInt(env.WEBSERVER_PORT)
    if (parsed > 0 && parsed <= 65536) {
      config.webServer.port = parsed
    }
  }

  if (env.IMAGE_REPOSITORY) {
    config.image.repository = resolve(env.IMAGE_REPOSITORY)
  }

  if (env.IMAGE_DEFAULTSIZE) {
    const parsed = parseInt(env.IMAGE_DEFAULTSIZE)
    if (parsed > 0) {
      config.image.defaultSize = parsed
    }
  }

  if (env.IMAGE_EXTENSIONS) {
    const parsed = env.IMAGE_EXTENSIONS.split(',').map(ext => ext.trim())
    config.image.extensions = parsed
  }

  if (env.CACHE_PATH) {
    config.cache.path = resolve(env.CACHE_PATH)
  }

  if (env.RENDER_JPGQUALITY) {
    const parsed = parseInt(env.RENDER_JPGQUALITY)
    if (parsed >= 0 && parsed <= 100) {
      config.render.jpgQuality = parsed
    }
  }

  if (env.RENDER_PNGCOMPRESSION) {
    const parsed = parseInt(env.RENDER_JPGQUALITY)
    if (parsed >= 0 && parsed <= 100) {
      config.render.pngCompression = parsed
    }
  }

  if (env.STATS_ENABLED) {
    config.stats.enabled = !!parseInt(env.STATS_ENABLED)
  }

  if (env.STATS_INTERVAL) {
    const parsed = parseInt(env.STATS_INTERVAL)
    if (parsed >= 0) {
      config.stats.interval = parsed
    }
  }

  if (env.STATS_CACHEHITSIZE) {
    const parsed = parseInt(env.STATS_CACHEHITSIZE)
    if (parsed >= 0) {
      config.stats.cacheHitSize = parsed
    }
  }
})()
