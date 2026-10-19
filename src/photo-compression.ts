export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = Math.floor(4.5 * 1024 * 1024);
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function photoSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

/** Resize oversized camera photos locally; the original File is never modified. */
export async function preparePhoto(file: File): Promise<File> {
  if (!PHOTO_TYPES.includes(file.type) || !file.size) throw new Error('JPG·PNG·WebP 사진 파일을 선택하세요.');
  if (file.size <= MAX_PHOTO_BYTES) return file;
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement('canvas');
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height) throw new Error('사진 크기를 확인할 수 없습니다.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 사진을 줄일 수 없습니다.');
    let edge = Math.min(3200, Math.max(bitmap.width, bitmap.height));
    for (let pass = 0; pass < 5; pass++) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.type !== 'image/webp') throw new Error('사진 자동 압축을 지원하는 최신 브라우저를 사용해 주세요.');
        if (blob.size > 0 && blob.size <= TARGET_BYTES) {
          const name = `${file.name.replace(/\.[^.]+$/, '')}-압축.webp`;
          return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
        }
      }
      edge = Math.max(1, Math.floor(edge * 0.7));
    }
    throw new Error('사진을 5MB 이하로 줄이지 못했습니다. 다른 사진을 선택해 주세요.');
  } catch (failure) {
    if (failure instanceof Error && failure.message.includes('사진')) throw failure;
    throw new Error('사진을 읽거나 압축하지 못했습니다. JPG·PNG·WebP 사진을 다시 선택해 주세요.');
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

