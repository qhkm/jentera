# Post-onboarding computer readiness

Implemented locally; not deployed.

- Dashboard and post-onboarding chat show the computer's setup/readiness state.
- Distinguishes missing setup, queued provisioning, readiness on the target release,
  sleeping, working, waking, updates, errors, and unavailable status.
- Uses the backend's last recorded runtime observation, not a fresh provider probe.
- Owners get setup/review links; other members are directed to their owner.
- No automatic provisioning or other mutations on dashboard mount.
- Polls transitional states every 3 seconds, stable states every 30 seconds, and
  retries read failures every 5 seconds. Pauses polling while the page is hidden.
- Ready/sleeping/working states use a compact row; setup allows adding business
  details while waiting. English and Bahasa Malaysia copy are provided.
- Removes the unconditional “Jentera is ready” greeting to avoid contradicting setup.

## Verification

- Frontend suite: 69 files, 504 tests passed; production build passed.
- Runtime route tests: 13 passed; worker typechecks passed.
- Mocked desktop/mobile browser checks covered setup, queued, ready, sleeping,
  and error states, plus the post-onboarding chat route.
- Mobile screenshots checked: no horizontal overflow, message composer visible.
- No production customer data or provisioning was used for verification.

## Release

Deploy the worker before the frontend: GET /api/runtime adds canManage and
setupStatus with private, no-store caching. Older responses fail closed for
management actions. No migrations, storage-key changes, or runtime fleet changes.
The separate compact handoff UI edits remain pending in the same worktree.
