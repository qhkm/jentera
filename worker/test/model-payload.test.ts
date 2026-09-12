import { describe, expect, it } from 'vitest';
import { prepareModelPayload, readModelBody } from '../src/model-payload';

describe('bounded transient model context', () => {
  it('omits earlier-turn images but preserves current vision and the stored input', () => {
    const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };
    const input = { messages: [
      { role: 'user', content: [image, { type: 'text', text: 'Old image' }] },
      { role: 'user', content: [{ type: 'text', text: 'Inspect this image' }, image] },
      { role: 'tool', tool_call_id: 'call-1', content: [image] },
    ] };
    const prepared = prepareModelPayload(input);
    const messages = prepared.body.messages as typeof input.messages;
    expect(messages[0].content[0]).toMatchObject({ type: 'text' });
    expect(messages[1].content[1]).toEqual(image);
    expect(messages[2]).toMatchObject({ tool_call_id: 'call-1', content: [image] });
    expect(input.messages[0].content[0]).toEqual(image);
    expect(prepared.hasImage).toBe(true);
  });

  it('bounds tool output with a visible omission notice and retains IDs, head and tail', () => {
    const content = 'BEGIN' + 'x'.repeat(80_000) + 'END';
    const prepared = prepareModelPayload({ messages: [
      { role: 'system', content }, { role: 'user', content },
      { role: 'assistant', tool_calls: [{ id: 'a' }], content: null },
      { role: 'tool', tool_call_id: 'a', content },
    ] });
    const messages = prepared.body.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toBe(content);
    expect(messages[1].content).toBe(content);
    expect(messages[2].tool_calls).toEqual([{ id: 'a' }]);
    expect(messages[3].tool_call_id).toBe('a');
    expect(messages[3].content).toMatch(/^BEGIN.*\n\[Tool output truncated/s);
    expect(String(messages[3].content).endsWith('END')).toBe(true);
    expect(String(messages[3].content).length).toBeLessThan(33_000);
  });

  it('measures UTF-8 bytes and rejects oversized bodies without Content-Length', async () => {
    expect(await readModelBody(new Request('https://example.com', { method: 'POST', body: 'éé' }), 3)).toBeNull();
    expect(await readModelBody(new Request('https://example.com', { method: 'POST', body: 'éé' }), 4)).toBe('éé');
  });
});
