/* ============================================================
   Who may do what.

   The role lives on `membership` (owner | staff) and reaches a route as
   `identity.role`. Every owner-only write used to be a hand-written
   `role !== 'owner'` at its call site — fourteen of them — so adding a
   third role meant fourteen edits. Now a permission is a row here, and a
   route asks `can(identity, 'approvals.decide')`.

   The table is the whole truth: a permission not listed does not exist,
   and a role not listed for a permission does not have it. `null` is a
   signed-in person with no membership; they can do nothing here.
   ============================================================ */

export const PERMISSIONS = {
  /** Change, import, confirm, and forget shared business knowledge. */
  'knowledge.manage': ['owner'],
  /** Connect, token-refresh and drop connectors. */
  'connections.manage': ['owner'],
  /** Hold the Telegram pairing link, which binds a chat as the owner chat. */
  'connections.pair': ['owner'],
  /** Create, edit, enable and disable specialist profiles. */
  'specialists.manage': ['owner'],
  /** Complete onboarding, reset it, mark setup done. */
  'business.setup': ['owner'],
  /** Policies and their reset. */
  'policies.manage': ['owner'],
  /** Approve or reject a proposed action on behalf of the business. */
  'approvals.decide': ['owner'],
  /** Provision, reconcile, upgrade, cancel tasks on, or delete the runtime. */
  'runtime.manage': ['owner'],
  /** Take and hand back control of the business browser. */
  'browser.control': ['owner'],
  /** Create, edit, schedule and run routines. */
  'routines.manage': ['owner'],
  /** Confirm or dismiss a task the agent left waiting on the owner. */
  'tasks.review': ['owner'],
  /** Invite people to the business and revoke invitations. */
  'team.manage': ['owner'],
  /** Create workspaces and decide who is in them. */
  'workspaces.manage': ['owner'],
  /** See and forget what the agent remembers; it holds notes about people. */
  'agent.memory': ['owner'],
} as const satisfies Record<string, readonly ('owner' | 'staff')[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(identity: { role: string | null }, permission: Permission): boolean {
  const roles: readonly string[] = PERMISSIONS[permission];
  return identity.role !== null && roles.includes(identity.role);
}
