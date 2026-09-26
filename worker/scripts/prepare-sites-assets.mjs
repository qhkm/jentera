import { copyFileSync, mkdirSync } from 'node:fs';

// Use the same identity and font files as the core app, not a second version.
const output = new URL('../public-sites/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const [source, target] of [
  ['../../app/public/favicon.svg', 'favicon.svg'],
  ['../../app/node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2', 'geist-sans.woff2'],
  ['../../app/node_modules/geist/LICENSE.txt', 'geist-LICENSE.txt'],
  ['../src/sites/booking-page.js', 'booking-page.js'],
]) copyFileSync(new URL(source, import.meta.url), new URL(target, output));
