// Scenario data + expected projections (the "factory data" the demo-url factory
// consumes). Values mirror demo/index.html's mock states so assertions stay in one
// place: if the mock changes, update here and every spec follows. These are the
// *rendered* strings the card produces from the mock, not raw entity states.
import type { DemoOptions } from '../helpers/demo-url';

export interface CardExpectation {
  /** Options to pass to TeslaCardPage.open(). */
  open: DemoOptions;
  /** Human label for test titles. */
  label: string;
  /** Substrings expected visible inside the card for this scenario. */
  visible: string[];
  /** Substrings expected NOT visible (e.g. live data when asleep). */
  absent?: string[];
}

// The vehicle name comes from card config (name: 'Model Y') and is install- and
// scenario-independent — the single most stable "the card rendered" signal.
export const CARD_NAME = 'Model Y';

export const AWAKE: CardExpectation = {
  open: { scenario: 'awake' },
  label: 'awake / charging',
  visible: [CARD_NAME, '72%', '235 mi', 'Charging'],
};

export const ASLEEP: CardExpectation = {
  open: { scenario: 'asleep' },
  label: 'asleep',
  // Battery/range collapse to an em-dash; the card frame still renders.
  visible: [CARD_NAME, '—'],
  absent: ['72%'],
};

// Foreign / unconfigured install (Story 1.6 designed-empty-state): no Tesla
// entities resolve and no registry is present. The card must still upgrade and
// render — vehicle name + neutral em-dash placeholders, never a false reading —
// and emit ZERO console/page errors (the consoleGuard is the "never crash"
// assertion). The committed analogue is src/fixtures/all-unresolved.json.
export const UNRESOLVED: CardExpectation = {
  open: { scenario: 'unresolved' },
  label: 'unresolved / foreign install',
  // The vehicle name comes from config and always renders; live values collapse
  // to an em-dash. The card frame (tab strip) still paints.
  visible: [CARD_NAME, '—'],
  // No false/overstated reading — the awake battery figure must NOT appear.
  absent: ['72%', '235 mi'],
};

// Same vehicle, differently-named device (my_tesla_* instead of garage_model_y_*).
// Proves the resolver matches entities by function-name, not a hard-coded prefix.
export const AWAKE_RENAMED: CardExpectation = {
  open: { scenario: 'awake', env: 'renamed' },
  label: 'awake / renamed device (my_tesla_*)',
  visible: [CARD_NAME, '72%', '235 mi'],
};

export const ALL_PANELS = [
  'Climate',
  'Charging',
  'Closures',
  'Tires',
  'Location',
  'Media',
  'Energy',
] as const;
