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
  'Tyres',
  'Location',
  'Media',
  'Energy',
] as const;
