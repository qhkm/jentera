/* ============================================================
   How a service can be connected — and which ways it actually offers.

   An owner asking Jentera to set something up is offered the ways that
   exist for that service. The point of the list is that it differs: one
   service publishes an MCP server, another only an API token, a third has
   no API at all and can only be reached by signing in.

   The methods differ in what they grant, which is why the owner chooses
   rather than us choosing for them:

   - `mcp`        the service's own MCP server. Nothing of the owner's is
                  held here beyond the grant they make to it.
   - `api_token`  a token from the service's settings. Held in the control
                  plane; a sprite never sees it. Costs the owner a short
                  errand in another app.
   - `browser`    the owner signs in through Jentera's browser and Jentera
                  reads the credential from the settings page. Quickest, and
                  the session stays in a browser the agent shares — see
                  `docs/superpowers/specs/2026-09-18-conversational-connect-design.md`.

   `browser` is listed only where a recipe exists in the runner bundle, so
   this file cannot promise a flow the fleet cannot run.
   ============================================================ */

export type ConnectMethod = 'mcp' | 'api_token' | 'browser';

export interface ConnectMethodOffer {
  method: ConnectMethod;
  /** What the owner is agreeing to, in their words rather than ours. */
  summary: string;
  /** Said plainly where a method grants more than the alternatives. */
  caution?: string;
}

interface ServiceMethods {
  label: string;
  /** Preferred first. The order is a recommendation, not a restriction. */
  methods: ConnectMethod[];
}

/** Keyed by the connector name on `connection.connector`. */
const SERVICES: Readonly<Record<string, ServiceMethods>> = Object.freeze({
  Bukku: { label: 'Bukku', methods: ['api_token', 'browser'] },
  Cloudflare: { label: 'Cloudflare', methods: ['api_token'] },
});

const SUMMARIES: Record<ConnectMethod, (label: string) => ConnectMethodOffer> = {
  mcp: (label) => ({
    method: 'mcp',
    summary: `Connect through ${label}'s own integration. You approve what Jentera may do, in ${label}.`,
  }),
  api_token: (label) => ({
    method: 'api_token',
    summary: `Paste a token from ${label}'s settings. A few steps in ${label}, and Jentera only gets what that token allows.`,
  }),
  browser: (label) => ({
    method: 'browser',
    summary: `Sign in to ${label} through Jentera's browser and it will set the rest up.`,
    /* The owner is choosing between convenience and exposure, so the
       exposure is named. The agent shares that browser and can read what
       is signed into it. */
    caution: `Quickest, but your ${label} session stays in Jentera's browser, where your AI staff can see it.`,
  }),
};

/** What this service offers, preferred first. Empty when it is not a
    service an owner can connect at all. */
export function connectMethods(connector: string): ConnectMethodOffer[] {
  const service = SERVICES[connector];
  if (!service) return [];
  return service.methods.map((method) => SUMMARIES[method](service.label));
}

export function supportsConnectMethod(connector: string, method: string): method is ConnectMethod {
  return connectMethods(connector).some((offer) => offer.method === method);
}

/** The connector name for something an owner typed, so "my bukku" and
    "Bukku" reach the same service without the model inventing one. */
export function connectorNamed(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  if (!wanted) return null;
  return Object.keys(SERVICES).find((name) => name.toLowerCase() === wanted
    || wanted.includes(name.toLowerCase())) ?? null;
}
