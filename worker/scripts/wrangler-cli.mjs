import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);

/** Run the repository-pinned Wrangler without depending on a package-manager shim in PATH. */
export function execWrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerEntry, ...args], {
    cwd: workerDir,
    ...options,
  });
}
