// @vitest-environment jsdom
//
// Element-level gate for Story 5.10 (Media Panel). The panel pre-existed (pre-BMAD
// prototype, token/string-migrated in Epic 2) and was already wired into the shell;
// this story builds the optimistic-then-reconcile boundary and pins these as
// regressions:
//   AC1 — now-playing art/metadata + transport (prev/play-pause/next) + mute +
//         volume slider render; the play button shows the PAUSE glyph when playing;
//         the slider reflects the fixture volume (40 from volume_level 0.4); art
//         falls back to the music-note glyph with no entity_picture, and to an
//         <img> when one is present;
//   AC2 — optimistic-then-reconcile (mute / play-pause / volume): a tap flips the
//         SIGHTED control instantly (before any hass change) and fires its service
//         EXACTLY once; a fresh hass matching the request clears the override;
//         aria-pressed/aria-label announce the SETTLED (pre-tap) state, never the
//         optimistic guess; the volume thumb HOLDS the requested level (no snap-back);
//   AC3 — the calm empty state on off/idle/unavailable/0-entity (controls disabled),
//         a missing volume disables the slider (no NaN%), nothing throws.
//
// Entity ids come from const.ts DEFAULT_ENTITIES (never inlined); a FRESH hass per
// state swap so Lit's @property change fires willUpdate; callService is a vi.fn()
// spy (single-call contract). Modelled on panel-climate.test.ts.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mdiPlay, mdiPause } from '@mdi/js';
import './panel-media';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import asleepFx from '../fixtures/model-y-asleep.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type PanelEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

const MEDIA = DEFAULT_ENTITIES.media_player;

/** Deep-clone the fixture states so each test mutates an isolated copy. */
function baseStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}

/** A fresh hass (new reference → Lit @property change fires) with a spy service. */
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return {
    states,
    callService: vi.fn().mockResolvedValue(undefined),
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant): Promise<PanelEl> {
  const el = document.createElement('tc-panel-media') as PanelEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card' }; // entities default to DEFAULT_ENTITIES
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Assign a fresh hass and settle the render (reconcile discipline). */
async function pushHass(el: PanelEl, states: Record<string, HassEntity>): Promise<HomeAssistant> {
  const hass = makeHass(states);
  el.hass = hass;
  await el.updateComplete;
  return hass;
}

const q = <T extends Element = Element>(el: PanelEl, sel: string): T | null =>
  el.shadowRoot!.querySelector<T>(sel);
const tbtns = (el: PanelEl) => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.tbtn')];
const play = (el: PanelEl) => q<HTMLButtonElement>(el, '.tbtn.play')!;
const mute = (el: PanelEl) => q<HTMLButtonElement>(el, '.mute')!;
const slider = (el: PanelEl) => q<HTMLElement & { value: number; disabled: boolean; label: string }>(el, 'tc-slider')!;
const playGlyph = (el: PanelEl) => play(el).querySelector('path')!.getAttribute('d');
const text = (el: PanelEl, sel: string) => q(el, sel)?.textContent?.trim() ?? '';
const optSize = (el: PanelEl) => Object.keys((el as unknown as { _optimistic: object })._optimistic).length;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ── AC1 — now-playing + transport + mute + volume render ──────────────────────
describe('AC1 — now-playing art/metadata + transport + mute + volume render', () => {
  test('title + artist render from the fixture (Bohemian Rhapsody / Queen)', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(text(el, '.title')).toBe('Bohemian Rhapsody');
    expect(text(el, '.artist')).toBe('Queen');
  });

  test('art falls back to the music-note glyph when no entity_picture', async () => {
    const el = await mount(makeHass(baseStates())); // fixture has no entity_picture
    expect(q(el, '.art img')).toBeNull();
    expect(q(el, '.art svg')).not.toBeNull(); // the mdiMusicNote glyph
  });

  test('art renders an <img> when entity_picture is present', async () => {
    const states = baseStates();
    states[MEDIA].attributes!.entity_picture = '/api/media_player_proxy/cover.jpg';
    const el = await mount(makeHass(states));
    const img = q<HTMLImageElement>(el, '.art img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/api/media_player_proxy/cover.jpg');
  });

  test('the transport row renders prev / play-pause / next (state-bearing aria)', async () => {
    const el = await mount(makeHass(baseStates()));
    const labels = tbtns(el).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([STRINGS.media.previous, STRINGS.media.pause, STRINGS.media.next]);
  });

  test('the play button shows the PAUSE glyph while playing', async () => {
    const el = await mount(makeHass(baseStates())); // state playing
    expect(playGlyph(el)).toBe(mdiPause);
  });

  test('the mute button + volume slider render; slider reflects the fixture volume (40)', async () => {
    const el = await mount(makeHass(baseStates())); // volume_level 0.4
    expect(mute(el)).not.toBeNull();
    expect(slider(el)).not.toBeNull();
    expect(slider(el).value).toBe(40);
    expect(slider(el).label).toBe(STRINGS.media.volume); // SR label passed through
  });
});

// ── AC2 — optimistic-then-reconcile + settled-state SR announce ───────────────
describe('AC2 — optimistic flip, single service call, reconcile, settled SR announce', () => {
  test('mute: tap flips the SIGHTED glyph instantly and fires volume_mute once', async () => {
    const hass = makeHass(baseStates()); // is_volume_muted false
    const el = await mount(hass);
    expect(mute(el).classList.contains('on')).toBe(false);
    expect(mute(el).getAttribute('aria-pressed')).toBe('false');
    mute(el).click(); // request mute — no hass tick yet
    await el.updateComplete;
    expect(mute(el).classList.contains('on')).toBe(true); // optimistic on
    expect(mute(el).getAttribute('aria-pressed')).toBe('false'); // SR still settled (unmuted)
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('media_player', 'volume_mute', {
      entity_id: MEDIA,
      is_volume_muted: true,
    });
  });

  test('mute: a reconciled hass (is_volume_muted true) clears the override', async () => {
    const el = await mount(makeHass(baseStates()));
    mute(el).click();
    await el.updateComplete;
    expect(optSize(el)).toBe(1);
    const states = baseStates();
    states[MEDIA].attributes!.is_volume_muted = true;
    await pushHass(el, states);
    expect(optSize(el)).toBe(0); // override cleared — settled now agrees
    expect(mute(el).classList.contains('on')).toBe(true); // now settled muted
    expect(mute(el).getAttribute('aria-pressed')).toBe('true');
  });

  test('play/pause: tap flips the SIGHTED glyph play→pause→? and fires once; aria settled', async () => {
    const hass = makeHass(baseStates()); // playing → settled pause icon
    const el = await mount(hass);
    expect(playGlyph(el)).toBe(mdiPause);
    expect(play(el).getAttribute('aria-label')).toBe(STRINGS.media.pause); // settled
    play(el).click(); // request pause → optimistic NOT playing → play glyph
    await el.updateComplete;
    expect(playGlyph(el)).toBe(mdiPlay); // optimistic flip
    expect(play(el).getAttribute('aria-label')).toBe(STRINGS.media.pause); // SR still settled
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('media_player', 'media_play_pause', {
      entity_id: MEDIA,
    });
  });

  test('play/pause: a reconciled hass (state paused) clears the override', async () => {
    const el = await mount(makeHass(baseStates())); // playing
    play(el).click(); // optimistic paused
    await el.updateComplete;
    expect(optSize(el)).toBe(1);
    const states = baseStates();
    states[MEDIA].state = 'paused';
    await pushHass(el, states);
    expect(optSize(el)).toBe(0);
    expect(playGlyph(el)).toBe(mdiPlay); // settled paused → play glyph
    expect(play(el).getAttribute('aria-label')).toBe(STRINGS.media.play);
  });

  test('volume: value-changed HOLDS the requested level (no snap-back) and sets it once', async () => {
    const hass = makeHass(baseStates()); // settled volume 40
    const el = await mount(hass);
    expect(slider(el).value).toBe(40);
    slider(el).dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: 75 }, bubbles: true, composed: true })
    );
    await el.updateComplete;
    expect(slider(el).value).toBe(75); // optimistic hold — not snapped back to 40
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: MEDIA,
      volume_level: 0.75,
    });
  });

  test('volume: a reconciled hass (volume_level 0.75) clears the override', async () => {
    const el = await mount(makeHass(baseStates()));
    slider(el).dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: 75 }, bubbles: true, composed: true })
    );
    await el.updateComplete;
    expect(optSize(el)).toBe(1);
    const states = baseStates();
    states[MEDIA].attributes!.volume_level = 0.75;
    await pushHass(el, states);
    expect(optSize(el)).toBe(0);
    expect(slider(el).value).toBe(75);
  });

  test('an expired fence honestly REVERTS the optimistic value when no command lands', async () => {
    vi.useFakeTimers();
    const el = await mount(makeHass(baseStates())); // unmuted
    mute(el).click(); // optimistic muted, fence armed
    await el.updateComplete;
    expect(mute(el).classList.contains('on')).toBe(true);
    vi.advanceTimersByTime(20_000); // no reconciling hass ever arrives
    await el.updateComplete;
    expect(mute(el).classList.contains('on')).toBe(false); // reverted to settled unmuted
  });

  test('prev/next stay fire-and-forget (no optimistic projection) but still call once', async () => {
    const hass = makeHass(baseStates());
    const el = await mount(hass);
    tbtns(el)[0].click(); // previous
    tbtns(el)[2].click(); // next
    await el.updateComplete;
    expect(optSize(el)).toBe(0); // no override armed for skip-track
    expect(hass.callService).toHaveBeenCalledTimes(2);
    expect(hass.callService).toHaveBeenNthCalledWith(1, 'media_player', 'media_previous_track', {
      entity_id: MEDIA,
    });
    expect(hass.callService).toHaveBeenNthCalledWith(2, 'media_player', 'media_next_track', {
      entity_id: MEDIA,
    });
  });

  test('disconnectedCallback clears the per-tap fence — no orphaned timer (UX-DR23)', async () => {
    vi.useFakeTimers();
    const el = await mount(makeHass(baseStates()));
    const timers = (el as unknown as { _timers: Map<string, unknown> })._timers;
    mute(el).click();
    await el.updateComplete;
    expect(timers.size).toBe(1);
    el.remove();
    expect(timers.size).toBe(0);
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
  });
});

// ── AC3 — calm empty state + NaN-safety, never a false "playing" ──────────────
describe('AC3 — graceful degradation: calm empty state, disabled controls, no NaN', () => {
  test('the asleep fixture (media_player off) lands in the calm empty state', async () => {
    const states = JSON.parse(JSON.stringify(asleepFx.states)) as Record<string, HassEntity>;
    const el = await mount(makeHass(states));
    expect(text(el, '.title')).toBe(STRINGS.media.notPlaying);
    expect(text(el, '.artist')).toBe(STRINGS.media.idle);
    expect(q(el, '.art')!.classList.contains('idle')).toBe(true);
    expect(tbtns(el).every((b) => b.disabled)).toBe(true);
    expect(mute(el).disabled).toBe(true);
    expect(slider(el).disabled).toBe(true);
  });

  test('a 0-entity hass (no media_player) renders the empty state without throwing', async () => {
    const states = baseStates();
    delete states[MEDIA];
    const el = await mount(makeHass(states));
    expect(text(el, '.title')).toBe(STRINGS.media.notPlaying);
    expect(tbtns(el).every((b) => b.disabled)).toBe(true);
  });

  test('an unavailable / idle player both collapse to the empty state', async () => {
    for (const st of ['unavailable', 'idle']) {
      const states = baseStates();
      states[MEDIA].state = st;
      const el = await mount(makeHass(states));
      expect(text(el, '.title')).toBe(STRINGS.media.notPlaying);
      expect(play(el).disabled).toBe(true);
      document.body.innerHTML = '';
    }
  });

  test('a playing player with a missing volume_level disables the slider (no NaN%)', async () => {
    const states = baseStates();
    delete states[MEDIA].attributes!.volume_level;
    const el = await mount(makeHass(states));
    expect(play(el).disabled).toBe(false); // transport still active (playing)
    expect(slider(el).disabled).toBe(true); // volume non-interactive
    expect(Number.isNaN(slider(el).value)).toBe(false); // never NaN
    expect(slider(el).value).toBe(0);
  });

  test('an off player never enters the optimistic path (no service call, no flip)', async () => {
    const states = baseStates();
    states[MEDIA].state = 'off';
    const hass = makeHass(states);
    const el = await mount(hass);
    mute(el).click(); // disabled → click is inert, but guard the path too
    play(el).click();
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled();
    expect(optSize(el)).toBe(0);
  });
});

// ── DoD a11y floor — settled aria + slider label (UX-DR21) ────────────────────
describe('DoD a11y — mute aria-pressed reflects settled, slider carries a label', () => {
  test('the mute toggle exposes aria-pressed reflecting the settled mute state', async () => {
    const states = baseStates();
    states[MEDIA].attributes!.is_volume_muted = true;
    const el = await mount(makeHass(states));
    expect(mute(el).getAttribute('aria-pressed')).toBe('true');
  });

  test('the volume slider carries the Volume SR label', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(slider(el).label).toBe(STRINGS.media.volume);
  });
});
