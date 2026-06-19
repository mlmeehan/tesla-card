// @vitest-environment jsdom
//
// Element-level gate for Story 5.5 AC1: the shared `statTile` primitive HIDES
// (renders `nothing`) when its backing value is absent — the panel passes
// `undefined` for a missing entity instead of a baked "—". A present value (even
// the indeterminate "—") renders unchanged, so existing call-sites are intact.
// jsdom opt-in like the other element tests; rendered via Lit's `render`.
import { afterEach, describe, expect, test } from 'vitest';
import { render, nothing } from 'lit';
import { mdiLightningBolt } from '@mdi/js';
import { statTile } from './ui';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(opts: Parameters<typeof statTile>[0]): HTMLElement {
  const host = document.createElement('div');
  render(statTile(opts), host);
  document.body.appendChild(host);
  return host;
}

describe('statTile — hide-when-missing (Story 5.5 AC1)', () => {
  test('an absent (undefined) value returns `nothing` and renders no .stat', () => {
    expect(statTile({ icon: mdiLightningBolt, label: 'Power', value: undefined })).toBe(nothing);
    const host = mount({ icon: mdiLightningBolt, label: 'Power', value: undefined });
    expect(host.querySelector('.stat')).toBeNull();
  });

  test('a present value renders the tile: icon-chip + key + value', () => {
    const host = mount({
      icon: mdiLightningBolt,
      label: 'Power',
      value: '7.4 kW',
      color: 'var(--tc-green, #34d399)',
    });
    expect(host.querySelector('.stat')).not.toBeNull();
    expect(host.querySelector('.ico-wrap')).not.toBeNull();
    // UPPERCASE is a CSS text-transform; the DOM text is the raw label.
    expect(host.querySelector('.k')?.textContent).toBe('Power');
    expect(host.querySelector('.v')?.textContent).toBe('7.4 kW');
  });

  test('a present-but-indeterminate "—" still renders (only absence hides)', () => {
    const host = mount({ icon: mdiLightningBolt, label: 'Power', value: '—' });
    expect(host.querySelector('.stat')).not.toBeNull();
    expect(host.querySelector('.v')?.textContent).toBe('—');
  });

  test("role='button' + tabindex only when an onClick is given (clickable)", () => {
    const plain = mount({ icon: mdiLightningBolt, label: 'Power', value: '1' });
    const plainStat = plain.querySelector('.stat')!;
    expect(plainStat.getAttribute('role')).toBeNull();
    expect(plainStat.getAttribute('tabindex')).toBeNull();

    document.body.innerHTML = '';
    let clicked = 0;
    const clickable = mount({
      icon: mdiLightningBolt,
      label: 'Power',
      value: '1',
      onClick: () => clicked++,
    });
    const stat = clickable.querySelector('.stat') as HTMLElement;
    expect(stat.getAttribute('role')).toBe('button');
    expect(stat.getAttribute('tabindex')).toBe('0');
    stat.click();
    expect(clicked).toBe(1);
  });
});
