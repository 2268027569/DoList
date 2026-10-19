/**
 * Time-ordered UUID v7 primary keys (docs/ARCHITECTURE.md §5.2).
 *
 * The 48-bit millisecond prefix is what makes this worth a helper instead of
 * `crypto.randomUUID()`: row ids sort by creation time, so index inserts stay
 * near the tail, and folder sync (M10) gets a stable, collision-free merge
 * order — a random v4 offers neither.
 */
export function newId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  // Overwrite bytes 0–5 with the big-endian timestamp. Doing it after drawing
  // the random bytes keeps the loop obvious at the cost of six wasted bytes.
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(now / 2 ** (8 * (5 - index))) & 0xff;
  }
  // Version 7 in the top nibble of byte 6, RFC 4122 variant in the top two bits
  // of byte 8; the rest of those bytes stays random.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
