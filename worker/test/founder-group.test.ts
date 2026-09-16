import { describe, expect, it } from 'vitest';
import { founderGroupUrl } from '../src/founder-group';

const url = `https://chat.whatsapp.com/${'A'.repeat(22)}`;
describe('server-only founder group configuration', () => {
  it('validates the supplied WhatsApp group invite', () => {
    expect(founderGroupUrl(url)).toEqual({ url });
  });
  it.each([undefined, '', 'javascript:alert(1)', url + '?x=y', url + '#x',
    url.replace('https:', 'http:'), url.replace('chat.whatsapp.com', 'attacker.example'),
    url.replace('chat.whatsapp.com', 'user:password@chat.whatsapp.com'),
    url.replace('chat.whatsapp.com', 'chat.whatsapp.com:8443'), 'https://chat.whatsapp.com/short'])('disables an invalid configuration: %s', value => {
    expect(founderGroupUrl(value)).toBeNull();
  });
});
