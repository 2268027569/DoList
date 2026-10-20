/**
 * What an attachment is drawn as, decided by its name (M03 S3).
 *
 * The panel draws an image as a preview card and everything else as a file row, and
 * the main process asks the platform for a thumbnail only for the former. Both ends
 * therefore have to answer the same question, and they answer it from this one list
 * rather than each keeping its own idea of what an image is.
 *
 * The extension is all there is to go on: the row stores a name, not a media type.
 * The list is deliberately the formats the two shipping platforms can thumbnail
 * themselves (Windows and macOS) — a card whose preview cannot be produced would be
 * a worse answer than the file row the fallback draws.
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

/** True when `name` reads as an image both platforms can preview. */
export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
