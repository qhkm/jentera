import { describe, expect, it } from 'vitest';
import { connectMethods, connectorNamed, supportsConnectMethod } from '../src/connect-methods';
import { EXECUTORS } from '../src/connectors';
import { isRuntimeConnector } from '../src/runtime/runtime-credentials';

describe('how a service can be connected', () => {
  it('offers only what the service actually has, preferred first', () => {
    expect(connectMethods('Bukku').map((o) => o.method)).toEqual(['api_token', 'browser']);
    /* Cloudflare has no settings page recipe, so it cannot be offered a
       browser sign-in that the fleet could not carry out. */
    expect(connectMethods('Cloudflare').map((o) => o.method)).toEqual(['api_token']);
    expect(connectMethods('Xero')).toEqual([]);
  });

  it('names the exposure on the method that has one', () => {
    const browser = connectMethods('Bukku').find((o) => o.method === 'browser');
    /* The owner is choosing between convenience and exposure. Offering the
       choice without naming the exposure is not offering a choice. */
    expect(browser?.caution).toMatch(/can see it/i);
    expect(connectMethods('Bukku').find((o) => o.method === 'api_token')?.caution).toBeUndefined();
  });

  it('describes each method without naming the protocol', () => {
    for (const offer of [...connectMethods('Bukku'), ...connectMethods('Cloudflare')]) {
      expect(offer.summary).not.toMatch(/\b(MCP|OAuth|API token|REST|JWT)\b/);
      expect(offer.summary.length).toBeGreaterThan(20);
    }
  });

  it('refuses a method the service does not offer', () => {
    expect(supportsConnectMethod('Bukku', 'browser')).toBe(true);
    expect(supportsConnectMethod('Cloudflare', 'browser')).toBe(false);
    expect(supportsConnectMethod('Bukku', 'mcp')).toBe(false);
    expect(supportsConnectMethod('Bukku', 'evaluate')).toBe(false);
  });

  it('finds the service an owner meant, without inventing one', () => {
    expect(connectorNamed('bukku')).toBe('Bukku');
    expect(connectorNamed('my Bukku account')).toBe('Bukku');
    expect(connectorNamed('  BUKKU ')).toBe('Bukku');
    expect(connectorNamed('autocount')).toBeNull();
    expect(connectorNamed('')).toBeNull();
  });

  /* A method offered for a connector nothing can execute is a setup flow
     that ends in a dead end. There are two ways a connector is executed and
     they are not interchangeable: the control plane holds the credential and
     makes the call, or the credential is delivered to the sprite and the
     agent makes it. Bukku is the first, Cloudflare the second. */
  it('offers no service that nothing can then act on', () => {
    for (const connector of ['Bukku', 'Cloudflare']) {
      if (!connectMethods(connector).length) continue;
      expect(Object.hasOwn(EXECUTORS, connector) || isRuntimeConnector(connector)).toBe(true);
    }
  });

  /* The browser method reads a credential off a settings page and hands it
     to the control plane. Offering it for a connector whose credential is
     delivered to the sprite instead would store something nothing reads. */
  it('does not offer a browser sign-in for a runtime connector', () => {
    for (const connector of ['Bukku', 'Cloudflare']) {
      if (isRuntimeConnector(connector)) {
        expect(supportsConnectMethod(connector, 'browser')).toBe(false);
      }
    }
  });
});
