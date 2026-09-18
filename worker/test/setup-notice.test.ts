import { describe, expect, it } from 'vitest';
import { isSetupNotice, setupNotice, SETUP_NOTICES } from '../src/runtime/setup-notice';

/* The text three businesses were shown on 2026-09-18 while their runtime
   was `ready`. It names a Fly host path and a filesystem we do not explain
   to anyone, about a failure that did not stop their Jentera working. */
const CHECKPOINT_WARNING =
  'Checkpoint failed after a healthy bootstrap; rollback point unchanged: Failed to create '
  + 'checkpoint: JuiceFS rename clone: rename /dev/fly_vol/juicefs/data/checkpoints/v37';
const INSTALL_FAILURE =
  'Sprite bootstrap exited 1: JENTERA_SETUP_STAGE:install pinned Hermes dependencies '
  + '(nanoid, undici, postcss, react-router)';

describe('what an owner is told about their runtime', () => {
  it('says nothing about a warning parked on a runtime that works', () => {
    /* This is the leak. A ready runtime is a working one; the note is ours
       to clear on the next release, not theirs to worry about. */
    expect(setupNotice('ready', CHECKPOINT_WARNING)).toBeNull();
    expect(setupNotice('ready', INSTALL_FAILURE)).toBeNull();
  });

  it('says nothing while it is still setting up or upgrading', () => {
    for (const status of ['provisioning', 'upgrading']) {
      expect(setupNotice(status, INSTALL_FAILURE)).toBeNull();
    }
  });

  it('tells the owner what to do when they genuinely cannot use it', () => {
    expect(setupNotice('error', INSTALL_FAILURE)).toBe(SETUP_NOTICES.retrying);
    expect(setupNotice('error', '')).toBe(SETUP_NOTICES.retrying);
    expect(setupNotice('error', 'no available host in region')).toBe(SETUP_NOTICES.capacity);
  });

  it('never lets the detail itself through', () => {
    for (const detail of [CHECKPOINT_WARNING, INSTALL_FAILURE,
      'Fly API 502 at https://api.machines.dev/v1/apps/aisar-b-1234/machines',
      '/dev/fly_vol/juicefs/data/checkpoints/v37', 'nanoid, undici, postcss']) {
      for (const status of ['ready', 'provisioning', 'upgrading', 'error']) {
        const notice = setupNotice(status, detail);
        if (notice === null) continue;
        expect(isSetupNotice(notice)).toBe(true);
        /* Nothing operator-shaped survives: no paths, hosts, stage names,
           status codes or package lists. */
        expect(notice).not.toMatch(/\/|https?:|JuiceFS|JENTERA_SETUP_STAGE|fly_vol|nanoid|\b\d{3}\b/);
      }
    }
  });
});
