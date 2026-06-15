// Console / page-error guard (network-error-monitor pattern, adapted for an offline
// component harness). Auto-attaches to every test and fails it at teardown if the
// card emitted an uncaught exception or an unexpected console error during the run.
// This turns "the card rendered" into "the card rendered *cleanly*" — catching Lit
// reactive-property errors, bad templates, and broken local assets for free.
//
// Ignored by default: the hermetic router's deliberate aborts of external hosts
// (`net::ERR_FAILED`) and the OpenStreetMap iframe. A genuine local 404 reads
// "status of 404" and is NOT ignored. The card's intentional version banner is a
// console.info (not an error), so it never trips this.
import { test as base, expect } from '@playwright/test';

export interface ConsoleGuard {
  /** Add a pattern to ignore (e.g. for an intentional negative test). */
  ignore(pattern: RegExp): void;
  /** Turn the teardown assertion off entirely for this test. */
  disable(): void;
  /** Snapshot of the errors collected so far. */
  errors(): string[];
}

const DEFAULT_IGNORES: RegExp[] = [
  /net::ERR_FAILED/i, // hermetic router aborts of external hosts
  /ERR_BLOCKED_BY_/i,
  /openstreetmap\.org/i, // the Location-panel map iframe
];

export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ page }, use) => {
      const ignores = [...DEFAULT_IGNORES];
      const errors: string[] = [];
      let disabled = false;

      const record = (kind: string, textRaw: string) => {
        if (ignores.some((re) => re.test(textRaw))) return;
        errors.push(`${kind}: ${textRaw}`);
      };
      const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() === 'error') record('console.error', msg.text());
      };
      const onPageError = (err: Error) => record('pageerror', err.message || String(err));

      page.on('console', onConsole);
      page.on('pageerror', onPageError);

      const guard: ConsoleGuard = {
        ignore: (pattern) => ignores.push(pattern),
        disable: () => {
          disabled = true;
        },
        errors: () => [...errors],
      };

      await use(guard);

      page.off('console', onConsole);
      page.off('pageerror', onPageError);

      if (!disabled) {
        expect(errors, 'card emitted no unexpected console/page errors').toEqual([]);
      }
    },
    { auto: true },
  ],
});
