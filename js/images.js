// Square-crops an uploaded image to a small, consistent thumbnail.
export const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export async function cropSquare(file, size = 256) {
  if (!ALLOWED.includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is too large (max 8 MB).');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close?.();
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  let blob = await toBlob('image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.88);
  if (!blob) throw new Error('Could not process the image.');
  return blob;
}
