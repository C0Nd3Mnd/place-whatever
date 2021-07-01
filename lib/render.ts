import { decode } from 'imagescript/mod.ts'
import { parse } from 'std/path/mod.ts'

export async function renderSize(
  originalPath: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const imageBytes = await Deno.readFile(originalPath)
  const image = await decode(imageBytes)

  const resized = image.resize(width, height)

  if (!resized) {
    throw new Error('Error during image resize.')
  }

  if (parse(originalPath).ext === 'png') {
    return resized.encode(3)
  } else {
    return resized.encodeJPEG(85)
  }
}
