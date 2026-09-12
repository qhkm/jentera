/* ============================================================
   The Team plan (migration 033).

   plan:
     'free' — one person, wake-on-request (migration 016).
     'pro'  — one person, always-on (migration 016).
     'team' — several people in one business: invitations, staff
              memberships and shared workspaces are accepted only on
              this plan. It includes 'pro': a team business is held
              always-on.

   Every account is one person unless its business is on 'team'. The
   plan stays a control-plane fact an operator sets; nothing here
   changes any existing business. The check constraint carries the
   name Postgres gave the inline check in 016.
   ============================================================ */

alter table if exists business
  drop constraint if exists business_plan_check;

alter table if exists business
  add constraint business_plan_check check (plan in ('free', 'pro', 'team'));
