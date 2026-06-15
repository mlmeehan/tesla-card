import { defineConfig, devices } from '@playwright/test';

// Tesla card E2E config. The system-under-test is the demo harness
// (demo/index.html) — a mock-`hass` shell that renders the real bundled card with
// zero Home Assistant dependency. The webServer below builds the card and serves
// the repo root so the harness can import ../dist/tesla-card.js.
const PORT = 4173;
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const VISUAL = !!process.env.VISUAL;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,

  // Visual snapshots are opt-in: cross-OS font/AA rendering differs, so they are
  // excluded from the default gate. `VISUAL=1` (npm run test:e2e:visual) includes
  // the @visual-tagged specs; seed baselines with --update-snapshots.
  grepInvert: VISUAL ? undefined : /@visual/,

  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Build first so dist/tesla-card.js exists, then serve. Routed through npm so
  // node_modules/.bin (http-server) is on PATH. reuseExistingServer keeps local
  // re-runs fast; CI always starts fresh.
  webServer: {
    command: 'npm run build && npm run serve:demo',
    url: `${BASE_URL}/demo/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
