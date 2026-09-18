/* ============================================================
   Services an owner connects by pasting a scoped token.

   The alternative is an interactive login, and on this product that is not
   a preference — `wrangler login` opens a browser on Jentera's machine for
   an owner who has no way to see it, so it blocks until the tool gives up.
   A token has no such problem, and it is the better grant besides: scoped
   to what the owner picked, and revocable on the provider's side without
   involving us.

   Every entry verifies before it is stored. A saved credential that has
   never been proven is a connection an owner believes in and a failure
   they meet later, in the middle of something else.
   ============================================================ */

export interface TokenConnectorAccount {
  /** The account on the far side, for the unique key on `connection`. */
  externalId: string;
  /** What the owner will recognise this connection as. */
  displayName: string;
}

export interface TokenConnector {
  /** Stored on `connection.connector`; matches RUNTIME_CREDENTIALS where
      this one's work is done by the agent rather than the Worker. */
  connector: string;
  label: string;
  /** A second value some providers need beside the token, and which is not
      itself a secret — Bukku's company subdomain, which every request must
      also carry as a header. Absent for providers the token alone opens. */
  account?: {
    label: string;
    hint: string;
    looksRight(value: string): boolean;
  };
  /** Rejected before any network call, and before the value could be
      logged by anything downstream. */
  looksRight(token: string): boolean;
  /** Proves the token works and names the account it opens. `account` is
      empty for connectors that do not declare one. */
  verify(token: string, account: string, fetchImpl?: typeof fetch): Promise<TokenConnectorAccount>;
}

interface BukkuCompanies {
  companies?: { id?: number; legal_name?: string; subdomain?: string }[];
}

interface CloudflareVerify {
  success?: boolean;
  result?: { id?: string; status?: string };
  errors?: { message?: string }[];
}

export const TOKEN_CONNECTORS: Readonly<Record<string, TokenConnector>> = Object.freeze({
  Cloudflare: {
    connector: 'Cloudflare',
    label: 'Cloudflare',
    /* Cloudflare API tokens are 40 URL-safe characters. Checked here so an
       obvious paste error is a message rather than a round trip, and so a
       pasted password never reaches an outbound request. */
    looksRight: (token) => /^[A-Za-z0-9_-]{35,120}$/.test(token),
    async verify(token, _account, fetchImpl = fetch) {
      const response = await fetchImpl('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as CloudflareVerify;
      if (!response.ok || !body.success) {
        const why = body.errors?.[0]?.message;
        throw new Error(
          why ? `Cloudflare rejected that token: ${why}` : 'Cloudflare rejected that token',
        );
      }
      if (body.result?.status && body.result.status !== 'active') {
        throw new Error(`That token is ${body.result.status}, not active`);
      }
      return {
        externalId: body.result?.id ?? 'cloudflare',
        displayName: 'Cloudflare API token',
      };
    },
  },
  Bukku: {
    connector: 'Bukku',
    label: 'Bukku',
    /* Bukku needs the company as well as the token, and sends it as its own
       header on every request. It is not a secret, so it is kept as the
       connection's `externalId` where execution can read it without going
       near the vault. */
    account: {
      label: 'Company subdomain',
      hint: 'The name in your Bukku address — for aisar.bukku.my, that is “aisar”.',
      looksRight: (value) => /^[a-z0-9][a-z0-9-]{1,38}$/i.test(value),
    },
    /* Bukku issues a JWT from Control Panel → Integrations → API Access. */
    looksRight: (token) => /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(token)
      && token.length <= 4_096,
    async verify(token, account, fetchImpl = fetch) {
      const subdomain = account.trim().toLowerCase();
      const response = await fetchImpl('https://api.bukku.my/companies', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Company-Subdomain': subdomain,
          Accept: 'application/json',
        },
      });
      /* Bukku separates these, so the owner can be told which half is
         wrong instead of retyping both. Verified against the live API on
         2026-09-18: a bad token answers 401, a missing company 403. */
      if (response.status === 401) throw new Error('Bukku rejected that token');
      if (response.status === 403) {
        throw new Error(`That token does not open the “${subdomain}” company`);
      }
      if (!response.ok) throw new Error(`Bukku could not be reached (${response.status})`);
      const body = (await response.json().catch(() => ({}))) as BukkuCompanies;
      /* A valid token for a different company would otherwise connect
         silently and fail later against books nobody meant to touch. */
      const company = body.companies?.find(
        (entry) => entry.subdomain?.trim().toLowerCase() === subdomain,
      );
      if (!company) throw new Error(`That token does not open the “${subdomain}” company`);
      return {
        externalId: subdomain,
        displayName: company.legal_name?.trim() || `Bukku · ${subdomain}`,
      };
    },
  },
});

export function tokenConnector(name: string): TokenConnector | null {
  return Object.hasOwn(TOKEN_CONNECTORS, name) ? TOKEN_CONNECTORS[name] : null;
}
