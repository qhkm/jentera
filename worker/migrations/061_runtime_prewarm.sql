-- What the last warm attempt did, so a slow first reply can be told apart:
-- warmed and still slow (the wake is not the problem) from never warmed
-- (the trigger did not fire, or fired too late to matter). `prewarmSprite`
-- reported only to console.info, and `wrangler tail` has been unreliable on
-- this worker, so the question was answerable only by inference.
alter table agent_runtime
  add column if not exists last_prewarm_at timestamptz,
  add column if not exists last_prewarm_outcome text,
  add column if not exists last_prewarm_ms integer,
  add column if not exists last_prewarm_source text;
