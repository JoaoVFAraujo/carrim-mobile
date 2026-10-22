import { InjectionToken } from '@angular/core';
import { photoByteLimit, type PreparedPhoto } from './photo-models';

export const PHOTO_PREPARER = new InjectionToken<(file: File) => Promise<PreparedPhoto>>(
  'photo preparer',
  {
    providedIn: 'root',
    factory: () => preparePhoto,
  },
);

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (
    !['image/jpeg', 'image/png'].includes(file.type) ||
    file.size < 16 ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error('Escolha uma foto JPEG ou PNG de até 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = imageDimensions(bytes);
  if (
    !size ||
    size.width < 1 ||
    size.height < 1 ||
    size.width * size.height > 16_777_216 ||
    size.width > 8192 ||
    size.height > 8192
  )
    throw new Error('A foto tem resolução excessiva ou não é uma imagem válida.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      const imageBase64 = data.split(',')[1];
      if (imageBase64 && imageBase64.length * 0.75 <= Math.min(photoByteLimit, 256 * 1024))
        return {
          imageBase64,
          contentType: 'image/jpeg',
          width: canvas.width,
          height: canvas.height,
        };
    }
    throw new Error('Não foi possível reduzir a foto. Escolha outra imagem.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Read dimensions before browser decoding to reject oversized compressed images. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR'
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    offset += length;
  }
  return null;
}
