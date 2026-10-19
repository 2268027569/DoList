/**
 * Order arithmetic for manual sorting (docs/M02-PLAN.md §7, decision D3).
 *
 * The main process holds one `sort_order` per row inside its group, and a move
 * writes the group's whole sequence back — a single small transaction on a local
 * file. So the only thing to work out here is where the moved id ends up in that
 * sequence, which is a permutation and nothing more.
 *
 * Kept pure and out of the panel so the pointer drag and the `Alt+↑/↓` keys go
 * through the same arithmetic, and so the clamping at the ends of the list is
 * unit-tested rather than discovered by dragging past the bottom row.
 */

/**
 * Moves one item to another position and returns the new order.
 *
 * `from` and `to` are clamped to the array, so a caller that has run off either end
 * (the top row asked to move up, a drop past the last row) gets the nearest real
 * position instead of an exception or a hole. When the move would change nothing —
 * both ends already equal, an empty list, a non-finite index — the same array comes
 * back *by reference*, which is how a caller can tell there is no write to make.
 */
export function moveWithin<T>(items: readonly T[], from: number, to: number): readonly T[] {
  const last = items.length - 1;
  if (last < 0 || !Number.isFinite(from) || !Number.isFinite(to)) return items;

  const start = clamp(Math.trunc(from), 0, last);
  const end = clamp(Math.trunc(to), 0, last);
  if (start === end) return items;

  const next = [...items];
  // Splice out then back in: the item lands at `end` in the array as it is without
  // it, which is the sequence the caller writes back.
  const [moved] = next.splice(start, 1);
  next.splice(end, 0, moved as T);
  return next;
}

/**
 * Where a pointer at `y` would drop, by each row's vertical midpoint. Returns the
 * index the item should occupy, so moving row 0 past row 1's midpoint yields 1.
 */
export function landingIndex(bands: readonly { top: number; height: number }[], y: number): number {
  if (bands.length === 0) return 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index] as { top: number; height: number };
    if (y < band.top + band.height / 2) return index;
  }
  return bands.length - 1;
}

/** The edge of a row a drop line is drawn against. */
export type DropEdge = 'top' | 'bottom';

/** Which edge of `index` the drop would land on, or `null` when nothing moves. */
export function dropEdge(
  move: { from: number; to: number } | null,
  index: number,
): DropEdge | null {
  if (move === null || move.to === move.from || move.to !== index) return null;
  return move.to < move.from ? 'top' : 'bottom';
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
