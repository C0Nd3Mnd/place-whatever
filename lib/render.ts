import { decode, GIF, Image } from 'imagescript/mod.ts'
import { parse } from 'std/path/mod.ts'
import { config } from '@/lib/config.ts'

export async function renderSize(
  originalPath: string,
  newWidth: number,
  newHeight: number
): Promise<Uint8Array> {
  const { pngCompression, jpgQuality } = config.render

  const imageBytes = await Deno.readFile(originalPath)
  const originalImage = await decode(imageBytes)

  const originalRatioIsWider =
    originalImage.width / originalImage.height > newWidth / newHeight

  if (originalImage instanceof GIF) {
    throw new Error('GIFs not supported.')
  }

  let resized: Image

  // If the original image has a wider ratio than the new one, base the resize
  // on the new height, else base it on the new width.
  if (originalRatioIsWider) {
    resized = originalImage.resize(Image.RESIZE_AUTO, newHeight)
    resized.crop((resized.width - newWidth) / 2, 0, newWidth, newHeight)
  } else {
    resized = originalImage.resize(newWidth, Image.RESIZE_AUTO)
    resized.crop(0, (resized.height - newHeight) / 2, newWidth, newHeight)
  }

  if (!resized) {
    throw new Error('Error during image resize.')
  }

  if (parse(originalPath).ext === 'png') {
    return resized.encode(pngCompression)
  } else {
    return resized.encodeJPEG(jpgQuality)
  }
}
