/**
 * A phone photo turned into a small square face for the employee row (the same rule as KPI's lib/avatar.ts):
 * cropped from the centre, scaled to 256 so the Rank 1s large photo stays sharp, saved as JPEG, stepping the
 * quality down until it fits set_my_avatar's 64 KB cap (KPI 0037).
 */
const SIZE = 256
const MAX_CHARS = 65536

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a photo.')) }
    img.src = url
  })
}

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo, a JPEG or a PNG.')
  const img = await load(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side < 64) throw new Error('That photo is too small.')
  const canvas = document.createElement('canvas')
  canvas.width = SIZE; canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize the photo.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE)
  let q = 0.8
  let url = canvas.toDataURL('image/jpeg', q)
  while (url.length > MAX_CHARS && q > 0.3) { q -= 0.1; url = canvas.toDataURL('image/jpeg', q) }
  if (url.length > MAX_CHARS) throw new Error('That photo will not compress small enough. Try another.')
  return url
}
