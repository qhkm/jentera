/* ============================================================
   Paid-plan gate for runtime entitlements (migration 016).

   plan:
     'free' — wake-on-request. The Sprite pauses after ~30s idle;
              responses carry a cold-wake 1-2s penalty on the first
              message. No compute is billed while idle.
     'pro'  — always-on. The worker includes `keepaliveUntil` on
              every dispatch and the runner holds the Sprite active
              through the Tasks API (continuous compute billing
              while held — this is the paid service being sold).

   The plan is a control-plane fact on the business. Billing/webhook
   integrations set it; the runtime only reads it.
   ============================================================ */

alter table if exists business
  add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro'));

create index if not exists idx_business_plan on business (plan)
  where plan <> 'free';
