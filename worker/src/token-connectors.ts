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
  /** Rejected before any network call, and before the value could be
      logged by anything downstream. */
  looksRight(token: string): boolean;
  /** Proves the token works and names the account it opens. */
  verify(token: string, fetchImpl?: typeof fetch): Promise<TokenConnectorAccount>;
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
    async verify(token, fetchImpl = fetch) {
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
});

export function tokenConnector(name: string): TokenConnector | null {
  return Object.hasOwn(TOKEN_CONNECTORS, name) ? TOKEN_CONNECTORS[name] : null;
}
