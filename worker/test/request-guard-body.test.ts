import { describe, expect, it } from 'vitest';
import { guardApiRequest, MAX_API_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } from '../src/request-guard';
import { ASK_FILE_PATH, INGEST_FILE_PATH, UPLOAD_DOCUMENT_LIMIT } from '../src/routes/runs';
import { testEnv } from './harness';

const INGEST = `https://api.test${INGEST_FILE_PATH}`;
const ASK = 'https://api.test/api/runs/ask';
const ASK_FILE = `https://api.test${ASK_FILE_PATH}`;

function upload(url: string, bytes: number, declareLength = true): Request {
  const body = new Uint8Array(bytes);
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Aisar-File-Name': 'menu.pdf',
      ...(declareLength ? { 'Content-Length': String(bytes) } : {}),
    },
    body,
  });
}

async function guard(request: Request): Promise<Response | null> {
  return guardApiRequest(request, testEnv(), new URL(request.url), {});
}

/* The guard runs before every route, so a route's own limit is only
   reachable if the guard agrees. Document upload's 8 MiB limit sat behind
   a flat 128 KiB cap until 14 September and could never be reached; the
   route's tests could not see it because they call the handler directly. */
describe('the pre-route body cap', () => {
  it('never caps below the route own ceiling', () => {
    expect(MAX_UPLOAD_BODY_BYTES).toBeGreaterThanOrEqual(UPLOAD_DOCUMENT_LIMIT);
  });

  it('lets a document through to the upload route', async () => {
    expect(await guard(upload(INGEST, 1024 * 1024))).toBeNull();
    expect(await guard(upload(ASK_FILE, 1024 * 1024))).toBeNull();
  });

  it('still refuses a document past the upload route own limit', async () => {
    const response = await guard(upload(INGEST, MAX_UPLOAD_BODY_BYTES + 1));
    expect(response?.status).toBe(413);
  });

  it('holds every other path to the small JSON cap', async () => {
    const response = await guard(upload(ASK, MAX_API_BODY_BYTES + 1));
    expect(response?.status).toBe(413);
  });

  it('measures an undeclared body against the path own cap', async () => {
    expect(await guard(upload(INGEST, 1024 * 1024, false))).toBeNull();
    const response = await guard(upload(ASK, MAX_API_BODY_BYTES + 1, false));
    expect(response?.status).toBe(413);
  });

  it('leaves a small JSON command alone', async () => {
    const request = new Request(ASK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(await guard(request)).toBeNull();
  });
});
