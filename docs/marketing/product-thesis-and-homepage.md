# Jentera: product thesis and homepage direction

Agreed direction: 11 September 2026.

This is the current reference for product positioning, homepage messaging, and
customer-facing UX. It supersedes earlier workforce-management framing in the
product vision. It describes the product direction, not a claim that every
example or integration is already available.

## Core thesis

> Jentera automates the day-to-day work businesses still do manually.

> Tell Jentera how the work gets done. Jentera handles it from then on.

The promise is business automation. “AI staff” is a simple supporting explanation
of the experience, not a requirement for customers to manage an AI workforce.

| Layer | What Jentera is |
| --- | --- |
| Marketing | AI staff that handles everyday business work |
| Product | Business automation layer |
| Technology | Agents, browser/computer use, APIs, and integrations |

Owners should not need to think about agents, VMs, MCP, workflows, or
orchestration. They describe the work and provide the necessary business context,
access, and decisions. Jentera handles the execution details.

## Positioning language

Long-form direction:

> AI automation for your business. Jentera handles the repetitive work across
> WhatsApp, spreadsheets, accounting systems and the apps you already use.

Local expression:

> Automate kerja harian bisnes yang masih dibuat manual.

Only name channels and capabilities in published copy when they are actually
supported. The longer statement is positioning direction, not permission to
advertise unfinished integrations.

## Product experience

An illustrative request:

> Every Friday, check unpaid invoices and WhatsApp customers who are overdue.

Jentera determines the steps, establishes the schedule and access, runs the work,
and brings the owner in when a decision is required. This example is a target
experience; its exact channels and actions must be verified before advertising it
as an available feature.

Chat is the entry point. A request becomes a durable task or recurring automation
that remains visible after the conversation ends. Follow-ups and retries should
continue the same task when appropriate.

The product's main concepts are:

- Automations: recurring commitments, with schedule, last result, next run, and
  a pause control.
- Tasks: explicit requested actions or deliverables with checkable outcomes.
- Approvals: specific decisions needed before an action can proceed.
- Activity: what actually happened, with results and an audit trail.
- Connections: access to the business's existing apps.
- Knowledge: confirmed business details used to do the work.

These concepts do not require six equally prominent navigation tabs. Connections
and Knowledge can remain under Business. Goals, employee performance dashboards,
agent rosters, and personalities are not the organizing principle.

## Home screen

Lead with outcomes and exceptions: what finished, what is running, what needs the
owner, and what happens next.

An illustrative summary:

> Jentera handled 143 tasks today. 3 things need your attention.

Use real, verified business outcomes and an explicit time period for such counts.
Do not count messages, tool calls, or classifier uncertainty as completed tasks.
Concrete summaries are often more useful than a total:

> 12 overdue invoices checked; 3 reminders need approval.

Every item needing attention must offer a meaningful next action. Review requires
an actual result to inspect; approval authorizes a specific action. Neither is a
fallback for uncertainty about what happened.

## Homepage messaging hierarchy

1. Lead with the outcome: **Your everyday business work, handled.**
2. Explain simply: **Tell Jentera what needs doing. It handles repetitive work
   across your connected apps and asks you when a decision is needed.**
3. Invite the first useful action: **Tell Jentera what to handle →**
4. Show concrete, supported examples of repetitive business work.
5. Explain the loop: describe the work, connect what is needed, review important
   decisions, and see the results.
6. Establish trust through visible results, permissions, approval boundaries,
   and clear control over recurring work.

“AI staff” supports this explanation. “AI staff that works 24/7” alone does not
communicate enough practical value. Avoid implying unconditional autonomy:
ongoing execution depends on setup, supported access, permissions, and approvals.

## Design and infrastructure references

The landing page and dashboard should share soft borders, rounded controls,
readable contrast, and clear typography. The landing page retains larger
headlines and more space between sections to explain the product.
Keep the main hero headline in Geist Pixel as a brand signature; softer surfaces
and smoother supporting typography do not require replacing that display font.

Muse is primarily an infrastructure reference: persistent computers, browser
control, background jobs, approval gates, permissions, audit trails, and secure
credential handling. Borrowing those capabilities does not require adopting an
AI workforce-management interface.

## Implementation status at this decision

The landing-page visual refresh is deployed. Rewriting homepage copy around this
messaging hierarchy is still pending. Saving this direction does not change the
live product, publish new promises, or authorize implementing every example.
