export function detectAvatarContentType(
  declared: string | null,
  body: Uint8Array,
): string | null {
  const contentType = declared?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType.startsWith('image/')) return contentType;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (
    body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47 &&
    body[4] === 0x0d && body[5] === 0x0a && body[6] === 0x1a && body[7] === 0x0a
  ) return 'image/png';
  const signature = new TextDecoder().decode(body.slice(0, 12));
  if (signature.startsWith('RIFF') && signature.endsWith('WEBP')) return 'image/webp';
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif';
  return null;
}
