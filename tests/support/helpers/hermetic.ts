// Network-first safeguard: make every test hermetic by aborting any request that
// leaves localhost. The card's Location panel embeds a live
// `<iframe src="openstreetmap.org">`; without this the suite would depend on the
// public internet (slow, flaky, and noisy in the console-error guard). Blocking
// non-local hosts keeps tests fully offline and deterministic — the iframe element
// still renders, only its remote document is suppressed.
//
// page.route intercepts the main frame *and* sub-frames, so the OSM iframe is
// covered. Aborted externals surface as `net::ERR_FAILED`, which the console guard
// ignores by default (see console-guard.ts) — distinct from a real local 404,
// which reads "status of 404" and is NOT ignored.
import type { Page } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export async function installHermeticRouting(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    let host = '';
    try {
      host = new URL(route.request().url()).hostname;
    } catch {
      // data:/blob: URLs have no host — always allow.
      return route.continue();
    }
    return LOCAL_HOSTS.has(host) ? route.continue() : route.abort();
  });
}
