import { join } from 'std/path/mod.ts'

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
  images: {
    /**
     * Path where all images are stored.
     */
    basePath: join(Deno.cwd(), '.imagerepo'),
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
    cachePath: join(Deno.cwd(), '.imagecache')
  }
}
