/**
 * The completion burst (docs/FEATURES.md M04).
 *
 * The popup's 「完成」 is the one answer that changes the data as well as closes the
 * announcement, so it is the one that gets an effect: a short spray of particles over
 * the card, drawn on a canvas that covers the window and takes no pointer events.
 *
 * Three things about it are deliberate:
 *
 *   - it is Canvas2D, not DOM. A hundred-odd particles are one `arc` each, and doing
 *     that in elements would mean a hundred layout boxes for a second of decoration;
 *   - it is a fixed length (~1.2 s) and resolves when it ends, so the answer is sent
 *     after the effect rather than under it — the window is closed by the main process
 *     as soon as the answer lands;
 *   - it is skipped entirely under `prefers-reduced-motion`, because an effect nobody
 *     asked for is exactly what that setting is about. The answer still goes through:
 *     the effect is decoration, never a step in the flow.
 *
 * The colours are read off the theme's `--burst-*` tokens (tokens.css) instead of being
 * named here, so the burst belongs to the active theme and the renderer keeps its
 * "no raw colours" discipline (§7).
 */

const COLOR_TOKENS = [
  '--burst-1',
  '--burst-2',
  '--burst-3',
  '--burst-4',
  '--burst-5',
  '--burst-6',
] as const;

const BURST_MS = 1_200;
const PARTICLE_COUNT = 110;
/** Downwards acceleration in px/s², so the spray falls the way sparks do. */
const GRAVITY = 900;
/** Launch speed range in px/s: wide enough to fill the card, low enough to stay in it. */
const SPEED = { min: 140, max: 460 };
const RADIUS = { min: 2, max: 5 };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

/** True when the user asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Plays the burst on `canvas` and resolves when it is over.
 *
 * A missing canvas or a reduced-motion preference resolves immediately — the caller
 * carries on to the write either way, which is why this never has to report a failure.
 */
export async function burst(canvas: HTMLCanvasElement | null): Promise<void> {
  if (canvas === null || prefersReducedMotion()) return;

  const context = canvas.getContext('2d');
  if (context === null) return;

  // Sized from the element, scaled for the display's pixel ratio: without this the
  // spray is soft on a scaled display, and the card is small enough that it shows.
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const palette = readPalette();
  const origin = { x: rect.width / 2, y: rect.height / 2 };
  const particles = Array.from({ length: PARTICLE_COUNT }, () => spawn(origin, palette));

  await new Promise<void>((resolve) => {
    let startedAt = 0;
    const frame = (now: number): void => {
      if (startedAt === 0) startedAt = now;
      const elapsed = (now - startedAt) / 1000;
      const progress = (now - startedAt) / BURST_MS;

      context.clearRect(0, 0, rect.width, rect.height);
      for (const particle of particles) draw(context, particle, elapsed, progress);
      context.globalAlpha = 1;

      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }
      // The canvas is cleared on the way out so the card is left as it was: the effect
      // is not a state the popup is left wearing while the main process closes it.
      context.clearRect(0, 0, rect.width, rect.height);
      resolve();
    };
    requestAnimationFrame(frame);
  });
}

function spawn(origin: { x: number; y: number }, palette: readonly string[]): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = SPEED.min + Math.random() * (SPEED.max - SPEED.min);
  return {
    x: origin.x,
    y: origin.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 120,
    radius: RADIUS.min + Math.random() * (RADIUS.max - RADIUS.min),
    color: palette[Math.floor(Math.random() * palette.length)] ?? palette[0] ?? 'currentColor',
  };
}

/** One particle at `elapsed` seconds in, fading out over the run. */
function draw(
  context: CanvasRenderingContext2D,
  particle: Particle,
  elapsed: number,
  progress: number,
): void {
  const x = particle.x + particle.vx * elapsed;
  const y = particle.y + particle.vy * elapsed + 0.5 * GRAVITY * elapsed * elapsed;
  const radius = particle.radius * (1 - progress * 0.6);

  context.globalAlpha = Math.max(0, 1 - progress);
  context.fillStyle = particle.color;
  context.beginPath();
  context.arc(x, y, Math.max(0.2, radius), 0, Math.PI * 2);
  context.fill();
}

/** The theme's burst colours, as the browser resolved them; never empty. */
function readPalette(): string[] {
  const styles = getComputedStyle(document.documentElement);
  const colors = COLOR_TOKENS.map((name) => styles.getPropertyValue(name).trim()).filter(
    (value) => value !== '',
  );
  if (colors.length > 0) return colors;
  // No theme tokens at all (a page rendered outside the app): the text colour is the
  // only colour that is guaranteed to exist, and the effect is decoration either way.
  return [styles.getPropertyValue('--text-primary').trim() || 'currentColor'];
}
