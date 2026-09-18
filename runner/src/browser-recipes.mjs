/* ============================================================
   Where a connector keeps its credentials, as code rather than as a
   parameter.

   The alternative is an `evaluate(js)` action, and that is a general grant
   to read and act as the owner in a browser holding every session they have
   signed into. A connector wanting two values off one settings page does
   not need that, and nothing else should get it as a side effect.

   So a caller names a recipe and nothing else. Adding one is a bundle
   change: reviewed, pinned, released — which is the right friction for code
   that reads credentials out of a logged-in browser.

   `host` is checked against the page the owner actually signed into before
   anything is read. Without it, a redirect — or an owner who wandered —
   would have us reading `#api_access_token` from whatever site happened to
   be open, and handing the result to the control plane as a credential.
   ============================================================ */

/** Selectors verified against a live Bukku account on 2026-09-18. */
export const BROWSER_RECIPES = Object.freeze({
  bukku: Object.freeze({
    label: 'Bukku',
    /* Every Bukku company is its own subdomain; the owner's is whichever
       one they signed into. */
    host: /^[a-z0-9][a-z0-9-]{0,38}\.bukku\.my$/i,
    path: '/cp/integrations',
    /* Turning this on is what generates the first token. When it is already
       on there is a token to read, and nothing is generated — the page's
       Refresh Token button would invalidate whatever else the owner has
       wired to Bukku, and no recipe may touch it. */
    toggle: Object.freeze({ selector: '#api_access_on', onClass: 'ant-switch-checked' }),
    read: Object.freeze({ token: '#api_access_token', subdomain: '#subdomain' }),
    /* A value that does not look like the thing we came for is not handed
       on as a credential; it means the page changed under us. */
    shape: Object.freeze({
      token: /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
      subdomain: /^[a-z0-9][a-z0-9-]{1,38}$/i,
    }),
  }),
});

export function browserRecipe(name) {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return Object.hasOwn(BROWSER_RECIPES, key) ? BROWSER_RECIPES[key] : null;
}

/** The recipe's page on the origin the owner is already signed into, or
    null when they are not on that service at all. */
export function recipeUrl(recipe, currentUrl) {
  let current;
  try { current = new URL(currentUrl); } catch { return null; }
  if (current.protocol !== 'https:' || !recipe.host.test(current.hostname)) return null;
  return new URL(recipe.path, current.origin).href;
}

/** Every field present and shaped like itself, or the reason it is not. */
export function recipeProblem(recipe, fields) {
  for (const name of Object.keys(recipe.read)) {
    const value = fields[name];
    if (typeof value !== 'string' || !value.trim()) return `missing_${name}`;
    const shape = recipe.shape[name];
    if (shape && !shape.test(value.trim())) return `unexpected_${name}`;
  }
  return null;
}
