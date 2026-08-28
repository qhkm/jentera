import { describe, expect, it, vi } from 'vitest';
import { handleEvents } from '../src/routes/events';
import type { Env } from '../src/env';

const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };

describe('activation events', () => {
  it('records only the bounded, pseudonymous funnel shape', async () => {
    const writeDataPoint = vi.fn();
    const env = { PRODUCT_ANALYTICS: { writeDataPoint } } as unknown as Env;
    const request = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ask_completed',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        route: '/app',
        elapsedSeconds: 73,
      }),
    });
    const response = await handleEvents(request, env, new URL(request.url), cors);

    expect(response?.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['123e4567-e89b-42d3-a456-426614174000'],
      blobs: ['ask_completed', '/app'],
      doubles: [73],
    });
  });

  it('rejects arbitrary event names and routes', async () => {
    const writeDataPoint = vi.fn();
    const env = { PRODUCT_ANALYTICS: { writeDataPoint } } as unknown as Env;
    const request = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'email_owner_everything',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        route: '/private/business-name',
        elapsedSeconds: 1,
      }),
    });
    const response = await handleEvents(request, env, new URL(request.url), cors);

    expect(response?.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
