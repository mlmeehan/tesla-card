// Demo-URL factory (data-factories pattern): one place that knows how to turn a
// set of options into the demo harness query string. Tests describe *what* they
// want (scenario, env, hero mode) and never hand-build URLs — so when the demo's
// param contract changes, it changes here only.
//
// The harness contract lives in `demo/index.html` (URLSearchParams):
//   scenario=asleep|parked|plugged|unresolved  awake/charging is the default (no param)
//   env=renamed                proves name-based resolution (my_tesla_* prefix)
//   panel=<id>                 default open panel
//   paint=<css|tesla-name>     tint the bundled generic-EV hero
//   image=1                    legacy flat <img> (demo/car.svg, committed)
//   recolor=1 | colorentity=…  photoreal recolor stack from demo/local/ (GITIGNORED)

export type Scenario = 'awake' | 'asleep' | 'parked' | 'plugged' | 'unresolved';
export type Env = 'default' | 'renamed';
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
  recolor?: boolean; // ?recolor=1 — REQUIRES demo/local art (see hasRecolorArt)
  colorentity?: string; // entity-driven paint (also implies recolor in the harness)
}

const DEMO_PATH = '/demo/index.html';

/** Build a demo path + query string from options. Relative to Playwright `baseURL`. */
export function buildDemoUrl(opts: DemoOptions = {}): string {
  const q = new URLSearchParams();
  if (opts.scenario === 'asleep') q.set('scenario', 'asleep');
  if (opts.scenario === 'parked') q.set('scenario', 'parked');
  if (opts.scenario === 'plugged') q.set('scenario', 'plugged');
  if (opts.scenario === 'unresolved') q.set('scenario', 'unresolved');
  if (opts.env === 'renamed') q.set('env', 'renamed');
  if (opts.panel) q.set('panel', opts.panel);
  if (opts.paint) q.set('paint', opts.paint);
  if (opts.image) q.set('image', '1');
  if (opts.recolor) q.set('recolor', '1');
  if (opts.colorentity) q.set('colorentity', opts.colorentity);
  const qs = q.toString();
  return qs ? `${DEMO_PATH}?${qs}` : DEMO_PATH;
}
