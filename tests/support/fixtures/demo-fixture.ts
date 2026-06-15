// `demo` fixture: hands each test a ready TeslaCardPage bound to the test's page.
// Kept as its own fixture file so it composes via mergeTests (see index.ts) —
// the fixtures-composition pattern: small single-purpose fixtures merged into one
// `test`, rather than one monolithic extend().
import { test as base } from '@playwright/test';
import { TeslaCardPage } from '../page-objects/tesla-card.page';

export const test = base.extend<{ demo: TeslaCardPage }>({
  demo: async ({ page }, use) => {
    await use(new TeslaCardPage(page));
  },
});
