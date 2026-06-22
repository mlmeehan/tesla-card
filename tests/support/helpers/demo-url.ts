// Demo-URL factory (data-factories pattern): one place that knows how to turn a
// set of options into the demo harness query string. Tests describe *what* they
// want (scenario, env, hero mode) and never hand-build URLs — so when the demo's
// param contract changes, it changes here only.
//
// The harness contract lives in `demo/index.html` (URLSearchParams):
//   scenario=asleep|parked|plugged|apertures|unresolved  awake/charging is the default (no param)
//   env=renamed                proves name-based resolution (my_tesla_* prefix)
//   panel=<id>                 default open panel
//   paint=<css|tesla-name>     tint the bundled generic-EV hero
//   image=1                    legacy flat <img> (demo/car.svg, committed)
//   recolor=1 | colorentity=…  photoreal recolor stack from demo/local/ (GITIGNORED)
//   recolor=broken             non-conforming body (mask dropped) — AC3 fall-through (needs NO art)
//   charge=charging|plugged|parked  pick the charge state (body-charge demo, Story 3.6)
//   frunk|liftgate|door|window=1  (apertures scenario) open ONLY those — independence check
//   unavail=<aperture>         (apertures scenario) force one entity unavailable — graceful-degrade check

export type Scenario = 'awake' | 'asleep' | 'parked' | 'plugged' | 'apertures' | 'unresolved';
export type SetupState = 'bare' | 'progress' | 'done';
export type ApertureName = 'frunk' | 'liftgate' | 'door' | 'window';
export type Env = 'default' | 'renamed' | 'tesla_custom';
export type PanelId =
  | 'climate'
  | 'charging'
  | 'closures'
  | 'tyres'
  | 'location'
  | 'media'
  | 'energy';

export interface DemoOptions {
  scenario?: Scenario; // default: 'awake'
  env?: Env; // default: 'default'
  panel?: PanelId; // default: harness uses 'charging'
  paint?: string; // tint the generic-EV default
  image?: boolean; // ?image=1 — flat car.svg
  recolor?: boolean | 'broken'; // ?recolor=1 (REQUIRES demo/local art) | 'broken' (non-conforming, no art)
  charge?: 'charging' | 'plugged' | 'parked'; // body-charge demo — pick the charge state (Story 3.6)
  colorentity?: string; // entity-driven paint (also implies recolor in the harness)
  apertures?: ApertureName[]; // (apertures scenario) open ONLY these — independence check
  unavail?: ApertureName; // (apertures scenario) force one entity unavailable — degrade check
  editor?: boolean; // ?editor=1 — mount the real config editor (tesla-card-editor) instead of just the card
  setup?: SetupState; // editor starting config: bare⇒wizard@Detect · progress⇒wizard@Confirm · done⇒normal form
}

const DEMO_PATH = '/demo/index.html';

/** Build a demo path + query string from options. Relative to Playwright `baseURL`. */
export function buildDemoUrl(opts: DemoOptions = {}): string {
  const q = new URLSearchParams();
  if (opts.scenario === 'asleep') q.set('scenario', 'asleep');
  if (opts.scenario === 'parked') q.set('scenario', 'parked');
  if (opts.scenario === 'plugged') q.set('scenario', 'plugged');
  if (opts.scenario === 'apertures') q.set('scenario', 'apertures');
  if (opts.scenario === 'unresolved') q.set('scenario', 'unresolved');
  if (opts.env === 'renamed') q.set('env', 'renamed');
  if (opts.env === 'tesla_custom') q.set('env', 'tesla_custom'); // AC4 — costly dialect
  if (opts.panel) q.set('panel', opts.panel);
  if (opts.paint) q.set('paint', opts.paint);
  if (opts.image) q.set('image', '1');
  if (opts.recolor === 'broken') q.set('recolor', 'broken');
  else if (opts.recolor) q.set('recolor', '1');
  if (opts.charge) q.set('charge', opts.charge);
  if (opts.colorentity) q.set('colorentity', opts.colorentity);
  for (const a of opts.apertures ?? []) q.set(a, '1'); // open only these (independence)
  if (opts.unavail) q.set('unavail', opts.unavail); // force one unavailable (degrade)
  if (opts.editor) q.set('editor', '1'); // mount the real config editor
  if (opts.setup) q.set('setup', opts.setup); // editor starting config state
  const qs = q.toString();
  return qs ? `${DEMO_PATH}?${qs}` : DEMO_PATH;
}
