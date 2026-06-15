/// <reference types="vitest/config" />
// ─────────────────────────────────────────────────────────────────────────────
// ONE config hosts BOTH the inner-loop dev server AND Vitest (architecture D5:
// "dev harness + Vitest in one"). This is intentional — do NOT split it into a
// separate vitest.config.ts.
//
// The shipped artifact is built by ROLLUP (rollup.config.mjs → dist/tesla-card.js)
// and Vite NEVER produces it. The dev loop and the release bundle are decoupled by
// design (architecture: "Bundler vs. Dev-Server — Decoupled"). A future "cleanup"
// must NOT fold the release build into Vite: keep `npm run build` on Rollup.
// ─────────────────────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const srcEntry = fileURLToPath(new URL('./src/tesla-card.ts', import.meta.url));

export default defineConfig({
  // `npm run dev` serves the existing demo/index.html (the same mock-hass harness
  // Playwright drives) — but against live `src/`, with HMR.
  root: 'demo',
  server: { open: false },
  resolve: {
    alias: [
      // DEV-ONLY indirection: demo/index.html statically imports the BUILT bundle
      // (`../dist/tesla-card.js`) so the file works under plain http-server in the
      // Playwright/CI path with NO bundler. Under Vite we transparently swap that
      // single import for the TS source, so editing any src/ module hot-reloads.
      // The `^…$` anchors match the WHOLE specifier so the replacement is the full
      // absolute path (a partial regex match would leave a dangling `../`).
      { find: /^\.\.\/dist\/tesla-card\.js$/, replacement: srcEntry },
    ],
  },
  test: {
    // Tests live beside src/ (co-located *.test.ts), not under demo/.
    root: '.',
    // Pure data/util hubs do not import Lit decorators or touch the DOM, so they
    // are node-testable without browser-mode (architecture Load-Bearing Assumption
    // a). DOM-needing component tests opt in per-file via
    // `// @vitest-environment jsdom` (jsdom is installed for exactly that).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
