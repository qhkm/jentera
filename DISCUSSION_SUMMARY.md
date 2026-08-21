# AISAR Product Discussion Summary

## North Star

AISAR should reduce the friction of adopting AI for a business to effectively zero. A non-technical owner should not need to learn prompts, agents, APIs, integrations, workflows, or infrastructure, and should not need to hire an expensive technical consultant before AI can complete useful work.

The simplest expression of the product is:

> A managed autonomous business operator for non-technical owners—powerful agent capability without installation, configuration, API keys, or technical knowledge.

Externally, customers work with one AISAR. Internally, AISAR may use multiple specialist agents, models, tools, skills, schedules, and integrations. That complexity stays behind the product.

## Ideal Customer and Positioning

The primary customer is a non-technical small-business owner or operator who knows AI could help but does not know where to start. Their business already runs through tools such as WhatsApp, Telegram, Instagram, email, calendars, spreadsheets, a POS, or a simple CRM. They want completed outcomes rather than a platform they must configure.

The agreed landing-page positioning is:

- **Headline:** “Your business, without the busywork.”
- **Core promise:** “You explain the business. AISAR handles the technology.”
- **Supporting idea:** AISAR becomes an affordable, on-demand AI implementation team that learns the business and puts the right capabilities to work.

Product language should say “put AISAR to work,” “handle this task,” and “connect your tools.” It should avoid exposing models, prompts, APIs, MCP servers, agent counts, or workflow builders.

## Intended Product Experience

AISAR follows a continuous loop:

1. **Learn:** Import a website, social profiles, documents, and connected accounts, or accept manual information.
2. **Find:** Identify repetitive work and rank opportunities by business value, confidence, and risk.
3. **Set up:** Select and configure the required AI capabilities behind the scenes.
4. **Put to work:** Request only the access or approval necessary to produce an outcome.
5. **Prove and improve:** Show completed work, time saved, exceptions, and the next useful opportunity.

Onboarding should offer two clear paths:

- **Import automatically:** the owner supplies a website and social profiles; AISAR extracts a reviewable business profile.
- **Enter manually:** the owner supplies the same information through a guided form.

Telegram must be supported wherever customer enquiry channels are selected. WhatsApp, Instagram, email, and other channels follow through the same managed connector model.

## Dashboard Information Architecture

The dashboard was simplified around four primary areas:

- **Home:** what happened, what needs attention, and the next useful action.
- **Ask AISAR:** ask for an update or instruct AISAR to handle work.
- **Activity:** structured completed, active, failed, and approval-blocked work.
- **My Business:** business knowledge, responsibilities, connections, and permissions.

Agent lists, team chat, connections, and approvals should not compete as separate technical products. Responsibilities and connections belong under My Business; approvals belong in Activity. The interface should remain outcome-first.

Ask AISAR was redesigned as a focused chat workspace. Customer conversations now live in a secondary Customer Inbox tab, so owner instructions and customer messages no longer appear as two competing chat products.

## Managed Hermes-Level Capability

Hermes represents the type of capability AISAR should make manageable: persistent memory, tools, reusable skills, scheduled work, delegation, browser or terminal execution, and messaging integrations. However, AISAR should not simply expose a hosted Hermes interface.

Hermes or another agent engine can be the initial runtime behind a provider-neutral adapter. AISAR must own the durable product layer:

- tenant and workspace isolation;
- verified business memory and knowledge;
- connector and credential management;
- action policies and owner approvals;
- scheduling, queues, retries, and reliability;
- audit history, outcomes, usage, and cost controls; and
- the non-technical onboarding and operating experience.

This separation keeps AISAR portable across models and agent runtimes. The defensible product is the managed business layer, not merely access to an agent engine.

## Chat Is Not the Activity Log

A major frustration with using an agent through Telegram is that everything becomes text. Long transcripts make it difficult to see what was completed, what failed, what is waiting, or what changed. AISAR must solve this directly.

The core rule is:

> Chat is where the owner asks. Activity is where the owner understands what happened.

Every instruction, proactive job, and external action should automatically become a structured work record. At a glance, the owner should see:

- the business outcome;
- status and completion time;
- channel, customer, or subject;
- any exception or approval required;
- useful counts and estimated time saved; and
- a link to further details.

Repeated work should be grouped by business meaning and time window. Instead of displaying 18 individual Telegram messages, AISAR should show something such as:

> **Telegram enquiries · Today**
> 18 handled · 2 bookings created · 1 escalated

Individual messages must remain traceable, but raw messages, retrieved sources, model details, tool calls, errors, and retries should be hidden under expandable business details and technical trace sections. Home summaries, notifications, and metrics must be generated from structured work records, not reconstructed from a long transcript.

AISAR should proactively provide a morning plan, exception alerts, an end-of-day digest, weekly outcomes, time saved, and a concise receipt after each instruction.

## Safety and Control

Zero setup does not mean zero control. Proposed actions should be classified before execution:

- **Automatic:** read-only or reversible, low-risk internal work.
- **Approval required:** customer messages, bookings, discounts, exports, or material record changes.
- **Blocked until enabled:** payments, destructive operations, or access outside the business policy.

Every approval should preserve the exact proposed action, parameters, risk, expiry, and approving owner. Every run should preserve an immutable technical trace while presenting a concise business outcome to the owner.

## First Production Vertical Slice

The first complete loop should be:

**Business import → reviewable memory → Ask AISAR → Telegram action → owner approval → execution → structured Activity record.**

It is complete when a non-technical owner can:

1. submit a business URL and confirm the extracted profile;
2. connect Telegram through a guided flow;
3. ask AISAR to respond to a realistic enquiry;
4. review, edit if wanted, and approve the exact outgoing message;
5. see successful delivery and a structured Activity record; and
6. correct a business fact and have the next response use it.

The owner must understand what happened without reading the Ask AISAR or Telegram transcript.

## Technical Direction

Keep the frontend on Cloudflare Pages and add a TypeScript control-plane API. Use durable queues or workflows for orchestration and retries. Run Hermes or another full agent runtime in isolated external containers because terminal and browser execution require a real sandbox. Store relational tenant state in managed Postgres, imported artifacts in private R2, and credentials in a managed secret vault with short-lived scoped grants.

Implementation should progress through four phases:

1. Persist imported business knowledge and make Ask AISAR answer from verified context.
2. Connect Telegram, prepare work, request approval, execute, and record outcomes.
3. Add schedules, low-risk automatic actions, WhatsApp, and calendar connectors.
4. Convert successful repeated work into tested, versioned business procedures.

## Success Metric and Immediate Next Step

The primary metric is **time to first useful work completed**, not agents created, onboarding completed, or workflows configured. Supporting metrics include successful execution rate, approval rate, correction rate, owner intervention per task, time saved, and how often an owner must open the technical trace to understand an outcome.

The immediate implementation step is Phase 1: scaffold the control-plane API and tenant data model, import a website into a source-backed business profile, persist that profile, and replace Ask AISAR’s demo responses with answers based on verified business context and structured activity data.

## Repository Status at Time of Summary

The main landing, onboarding, dashboard, Telegram channel, and Ask AISAR interface changes were committed as:

`bbd9f0a feat: simplify AI adoption journey for business owners`

The managed-agent architecture and operational-visibility documentation added after that commit remain uncommitted at the time this summary was written.
