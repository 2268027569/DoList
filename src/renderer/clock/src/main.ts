import './clock.css';
import { applyBootParams, readBoot } from '../../shared-ui/boot';

/**
 * The desktop clock's entry (docs/FEATURES.md M03).
 *
 * Deliberately React-free and i18next-free, like the marker: this window is resident
 * from launch to quit, and all it ever changes is a handful of text nodes. The panel
 * already carries the time inside it; this entry exists because the clock has to be
 * readable while the panel is put away, which is most of the time.
 *
 * The digits are assembled from `Intl.DateTimeFormat` parts rather than from a fixed
 * `HH:mm` string, so a locale that puts the period after the time (en-US) gets its
 * "PM" in the side column while a 24-hour locale simply has no period to draw.
 */
main();

const SECOND_MS = 1000;

function main(): void {
  const boot = readBoot();

  const clock = query('clock');
  const dateNode = query('clock-date');
  const hourNode = query('clock-hour');
  const minuteNode = query('clock-minute');
  const secondNode = query('clock-second');
  const periodNode = query('clock-period');
  if (
    clock === null ||
    dateNode === null ||
    hourNode === null ||
    minuteNode === null ||
    secondNode === null ||
    periodNode === null
  ) {
    return;
  }

  let locale = boot.locale;
  let timeFormat = timeFormatter(locale);
  let dateFormat = dateFormatter(locale);

  const render = (): void => {
    const now = new Date();
    let hour = '';
    let minute = '';
    let period = '';
    for (const part of timeFormat.formatToParts(now)) {
      if (part.type === 'hour') hour = part.value;
      else if (part.type === 'minute') minute = part.value;
      else if (part.type === 'dayPeriod') period = part.value;
    }

    setText(hourNode, hour);
    setText(minuteNode, minute);
    setText(secondNode, String(now.getSeconds()).padStart(2, '0'));
    setText(periodNode, period);
    setText(dateNode, dateFormat.format(now));

    // `<time>` carries the machine-readable instant and one spoken label; neither is
    // announced on a timer (the card is not a live region), they are what a reader
    // gets when it reaches this window.
    clock.setAttribute('dateTime', now.toISOString());
    clock.setAttribute('aria-label', now.toLocaleString(locale));
  };

  // Aligned to the second boundary rather than a chain started at launch: the digits
  // turn over when the second does, not when this window happened to boot.
  const tick = (): void => {
    render();
    window.setTimeout(tick, SECOND_MS - (Date.now() % SECOND_MS));
  };
  tick();

  window.api.on.themeChanged((params) => {
    applyBootParams(params);
  });

  window.api.on.localeChanged((params) => {
    locale = params.locale;
    timeFormat = timeFormatter(locale);
    dateFormat = dateFormatter(locale);
    render();
  });
}

function timeFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
}

function dateFormatter(locale: string): Intl.DateTimeFormat {
  // The scoreboard's scoreboard line: weekday first, then the date. The stylesheet
  // upper-cases it and spaces the letters, so the string itself stays locale-cased.
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Writes only when the value changed: a clock ticks once a second, forever. */
function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function query(field: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-field="${field}"]`);
}
