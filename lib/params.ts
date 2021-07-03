import { config } from '@/lib/config.ts'
import { imageList } from '@/lib/image.ts'

export interface Params {
  category?: string
  width?: number
  height?: number
}

export function parse(url: string): Params {
  const rawParams = url
    .split('/')
    .map(part => part.trim().toLowerCase())
    .filter(part => part !== '')

  const { sizeLimit, defaultSize } = config.image

  const params: Params = {}

  for (const rawParam of rawParams) {
    const parsed = parseInt(rawParam)

    if (isNaN(parsed)) {
      // Not a number, so it should be a category.
      if (params.category) {
        // Category already given.
        throw new Error(`Invalid parameter: ${rawParam}`)
      }

      params.category = rawParam
    } else if (parsed < 1 || parsed > sizeLimit) {
      throw new Error(
        `Image size out of valid range (1-${sizeLimit}): ${parsed}`
      )
    } else if (params.width && params.height) {
      throw new Error('Width and height already specified!')
    } else if (params.width) {
      params.height = parsed
    } else {
      params.width = parsed
    }
  }

  if (!params.width) {
    params.width = defaultSize
  }

  if (!params.height) {
    params.height = params.width
  }

  if (
    params.category &&
    !imageList.find(image => image.category === params.category)
  ) {
    params.category = undefined
  }

  return params
}
