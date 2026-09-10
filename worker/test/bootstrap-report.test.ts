import { describe, expect, it } from 'vitest';
import { bootstrapReport } from '../src/runtime/provision';

describe('what the bootstrap reports back to the control plane', () => {
  const line = (body: unknown) => JSON.stringify(body);

  it('takes the fields and stage timings off the last stdout line', () => {
    /* The bootstrap logs freely before its result; only the final line is the
       record. */
    const stdout = [
      'installing hermes…',
      'runtime bootstrap transfer: ignoring unknown field FUTURE_B64',
      line({
        ok: true, release: '2026.09.10-4', provider: 'openrouter', model: 'x',
        checkpointCreated: true,
        ignoredFields: ['FUTURE_B64'],
        stages: { install: 41, npm: 63, playwright: 12, configure: 3, smokes: 29 },
      }),
    ].join('\n');
    expect(bootstrapReport(stdout)).toEqual({
      ignoredFields: ['FUTURE_B64'],
      stages: { install: 41, npm: 63, playwright: 12, configure: 3, smokes: 29 },
    });
  });

  it('omits both when the bundle applied everything', () => {
    /* An empty list is not worth storing — absence says the same thing and
       keeps the common result row small. */
    expect(bootstrapReport(line({ ok: true, ignoredFields: [], stages: {} }))).toEqual({});
  });

  it('survives a bootstrap that says nothing useful', () => {
    /* Diagnostics must never un-provision a runtime that has already attested
       readiness, so anything unparseable is dropped rather than thrown. */
    for (const stdout of ['', 'not json at all', '{"ok":true}', 'null', '[]', '{oops']) {
      expect(() => bootstrapReport(stdout)).not.toThrow();
      expect(bootstrapReport(stdout)).toEqual({});
    }
  });

  it('drops entries of the wrong shape rather than trusting the line', () => {
    /* The line is produced by shell string-building, so a malformed value is
       a real possibility and must not reach the database as one. */
    expect(bootstrapReport(line({
      ignoredFields: ['GOOD_B64', 42, null],
      stages: { install: 41, npm: 'slow', playwright: null },
    }))).toEqual({
      ignoredFields: ['GOOD_B64'],
      stages: { install: 41 },
    });
  });
});
