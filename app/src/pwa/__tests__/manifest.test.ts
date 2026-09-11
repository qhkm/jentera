import { describe, expect, it } from 'vitest';
import { manifest } from '@/pwa/manifest';

describe('web app manifest', () => {
  it('describes Jentera as an installable app that opens in the workspace', () => {
    expect(manifest).toMatchObject({
      name: 'Jentera',
      short_name: 'Jentera',
      id: '/app',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ships the icon sizes every store and home screen asks for', () => {
    const icons = manifest.icons ?? [];
    const sizes = icons.map((icon) => `${icon.sizes}:${icon.purpose ?? 'any'}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/^\/icons\/.+\.png$/);
    }
  });

  it('offers the chat as a shortcut', () => {
    expect(manifest.shortcuts).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: '/app?view=chat' }),
    ]));
  });
});
