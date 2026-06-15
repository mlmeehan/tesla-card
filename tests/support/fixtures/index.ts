// Composed test entry point. Every spec imports { test, expect } from here.
// mergeTests fuses the independent fixtures (demo page object + auto console guard)
// into a single test object — add a new capability by writing another `base.extend`
// fixture file and merging it in below.
import { mergeTests } from '@playwright/test';
import { test as demoTest } from './demo-fixture';
import { test as consoleGuardTest } from './console-guard';

export const test = mergeTests(demoTest, consoleGuardTest);
export { expect } from '@playwright/test';

export { TeslaCardPage } from '../page-objects/tesla-card.page';
export type { PanelName } from '../page-objects/tesla-card.page';
export * from './scenarios';
