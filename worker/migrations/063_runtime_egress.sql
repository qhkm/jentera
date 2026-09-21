-- Where a sprite actually is, recorded from the calls it already makes.
--
-- `RUNTIME_EXPECTED_REGION` has said `sin` since it was introduced, and
-- `/api/runtime` reports every runtime as optimal, different or unknown
-- against it. It has only ever answered unknown. The runner reports
-- `process.env.FLY_REGION ?? req.headers['fly-region']` and neither exists
-- inside a sprite: there is no Fly environment there, and the worker
-- reaches the runner over its sprites.app URL, which carries no such
-- header. So `region` arrives null, every provision, upgrade and reconcile
-- task records the empty string, and nothing has ever been compared.
--
-- Probed directly on 21 September 2026, 4 of 10 sprites egress from the
-- United States -- including the one belonging to the business the owner
-- tests with. Nobody saw it because the instrument reads blank.
-- docs/sprite-egress-region-2026-09-21.md has the sample.
--
-- The sprite cannot answer this about itself. It has no Fly metadata, and
-- its own `/.sprite/api.sock` `/info` returns id, name, url and version
-- and no location. But every sprite calls this worker with its own
-- credential -- the model proxy on every model call, the config channel,
-- the artifact upload -- and on those requests `request.cf` describes the
-- caller. That is the sprite egress, seen from our own edge, with no
-- runner change and so no fleet release.
--
-- Two fields, because they answer different questions. `egress_colo` is
-- the Cloudflare edge that took the request, which is what compares
-- against a Fly region code. `egress_country` is the country assigned to
-- the address itself, which is what a website geolocates -- and the two do
-- disagree: one sprite answers at HKG on a Singapore address.
alter table agent_runtime
  add column if not exists egress_colo text,
  add column if not exists egress_country text,
  add column if not exists egress_seen_at timestamptz;
