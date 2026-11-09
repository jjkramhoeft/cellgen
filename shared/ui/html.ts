/** Small helpers for building panel HTML from strings. */

/** Escape text for use inside HTML element content or a double-quoted attribute. */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Ends every tooltip under `host` with its config key in brackets: tooltips not tied to a
 * setting (read-only statistics) get `[no config]`, so every hover says what to edit in the JSON.
 */
export function tagTooltips(host: HTMLElement): void {
  for (const e of host.querySelectorAll<HTMLElement>('[title]')) if (!e.title.endsWith(']')) e.title += ' [no config]';
  for (const t of host.querySelectorAll('svg title')) if (!t.textContent!.endsWith(']')) t.textContent += ' [no config]';
}
