/* The live read-only view under a running task had no height on any screen
   wider than 960px. Its screen box is `flex: 1` — grow from nothing — inside a
   column whose own height is auto in the chat panel, so there was nothing to
   grow into: measured in Chrome at 1440×763 on 26 September, 478×0 where
   65dvh would have been 496. noVNC fitted the desktop into that and drew
   nothing, and the "Connecting…" overlay sat in the same empty box. The
   takeover dialog gives the box a height and phones get a fixed one, which is
   why it only failed here. jsdom does not lay out, so this reads the rule. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/ask.css'), 'utf8');
const display = readFileSync(resolve(process.cwd(), '../runner/bin/display-service.sh'), 'utf8');

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries(body.split(';').map((part) => part.split(':').map((side) => side.trim()))
    .filter(([name, value]) => name && value));
}

describe('the live view under a running task', () => {
  const rule = declarations('.computer-preview-panel .business-desktop-stage-shell');

  it('sizes its screen box itself instead of growing into a parent with no height', () => {
    expect(rule.flex).toBe('none');
    expect(rule.height).toBe('auto');
    expect(rule['max-height']).toBeDefined();
  });

  it('keeps the proportions of the sprite’s screen, so the desktop fills the box', () => {
    const [width, height] = (display.match(/AISAR_DISPLAY_GEOMETRY:-(\d+)x(\d+)/) ?? []).slice(1).map(Number);
    const [ratioWidth, ratioHeight] = (rule['aspect-ratio'] ?? '').split('/').map((side) => Number(side.trim()));
    expect(width && height).toBeTruthy();
    expect(ratioWidth / ratioHeight).toBeCloseTo(width / height, 5);
  });
});
