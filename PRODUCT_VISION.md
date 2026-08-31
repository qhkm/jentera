# Jentera Product Vision

## Purpose

Jentera exists to reduce the technical friction of adopting AI to effectively zero. A business owner should not need to become an AI expert, hire a technical team, or fund a large consulting project before AI can produce useful work.

## The Problem

Most AI and automation products still sell a toolbox. Customers must understand agents, prompts, models, APIs, integrations, triggers, testing, and maintenance. No-code products remove programming but often leave the implementation decisions with the customer.

Jentera absorbs that implementation burden. The customer explains the business, shares the information they already have, and approves important decisions. Jentera handles the technology behind the scenes.

## Ideal Customer Profile

The primary customer is a non-technical small-business owner or operator who:

- knows AI could help but does not know where to begin;
- runs repetitive customer-service or operational processes;
- already works through tools such as WhatsApp, Telegram, Instagram, email, calendars, spreadsheets, a POS, or a basic CRM;
- has no internal AI or automation team;
- values a working outcome more than a configurable platform.

Jentera is built for business owners, not developers.

## Positioning

**Headline:** Your business, without the busywork.

**Core promise:** You explain the business. Jentera handles the technology.

**Positioning statement:** Jentera learns how a business runs, identifies where AI can create the most value, and puts the right AI help to work—without technical skills, expensive consultants, or workflows to configure.

Internally, Jentera is an autonomous AI implementation platform. Externally, it should feel like an on-demand implementation team that sets itself up.

## Managed Autonomy

Jentera should provide the capability of a powerful autonomous agent—persistent memory, tools, reusable skills, scheduled work, delegation, and multi-channel messaging—as a managed service. Owners should never have to install an agent, select a model, manage API keys, configure tools, or maintain infrastructure.

The underlying agent runtime is replaceable. Jentera owns the durable business layer around it: verified business knowledge, permissions, integrations, approvals, audit history, reliability, and the non-technical customer experience. Internally there may be many specialist workers; externally the customer works with one Jentera.

## Company Thesis and Product Portfolio

Jentera is an infrastructure company for AI agents. The managed business operator described in this document is one product experience built on that infrastructure; it does not require every future capability to become part of one monolithic application.

The long-term portfolio has distinct, composable products:

- **Jentera Compute:** persistent, isolated computers on which AI agents can run with files, memory, browser, terminal, and durable execution.
- **Jentera Connect:** one secure interface through which any compatible AI agent can use the software Southeast Asian businesses run on. An agent does not need to run on Jentera Compute to use Connect.
- **Jentera Control:** the shared trust and operations layer for identity, permissions, credentials, approvals, budgets, observability, and audit history across Jentera products.
- **Jentera Solutions:** ready-to-use workers and business procedures assembled from Compute, Connect, and Control for customers who want an outcome rather than infrastructure.
- **Jentera Marketplace:** a later distribution layer for connectors, skills, procedures, and agent packages. It becomes a product only after there is sufficient customer demand and third-party supply.

The products reinforce one another but remain independently useful. A developer may use only Connect with an agent hosted elsewhere. A platform team may combine Compute, Connect, and Control. A non-technical business may buy a finished Solution without seeing any of the underlying infrastructure.

Control is a horizontal foundation, not merely another dashboard. API, MCP, SDK, and CLI are delivery interfaces into Compute and Connect; they should not be presented as a separate “Developer Platform” product unless they later acquire a distinct commercial boundary.

The company-level message is:

> **Jentera provides the infrastructure AI agents need to do real work—computers, business tools, and operational control.**

The initial Connect message is:

> **Connect any AI agent to the software Southeast Asian businesses run on.**

The long-term category ambition is:

> **The agent interface for Southeast Asian businesses.**

These statements do not replace the outcome-first language used for the managed SMB experience. Product pages should speak to their actual audience: infrastructure and interoperability for developers, completed business work for owners.

### Portfolio sequence

1. Prove Compute and the shared Control foundation through the current managed-agent product.
2. Develop Connect around a small number of excellent Southeast Asian integrations and make its contracts independent of the hosted runtime.
3. Add a unified data layer to Connect: embedded account linking, canonical models, normalized reads and writes, webhooks, synchronization, and connection health across providers in the same business-software category.
4. Expose those capabilities as agent-native tools and higher-level regional business procedures through API, SDK, MCP, and eventually CLI.
5. Package repeatable outcomes as Jentera Solutions for non-technical businesses.
6. Add Marketplace only when external supply and demand justify a distribution product.

Connect is therefore a credible adjacent product direction, not a requirement for the first managed-product release. Its development must not delay the first complete useful-work loop.

The strategic reference for Connect's unified data layer is [Merge Unified](https://www.merge.dev/unified-api): customers link an account once, provider data is mapped into common models, applications read and write through one contract, and the platform maintains synchronization and provider changes. Jentera applies that model to the software Southeast Asian businesses use, then extends it with agent-native actions, Control policies, approvals, and regional business procedures. The goal is not a smaller copy of Merge's global catalogue; it is a deeper interface for regional business operations.

## Product Experience

Jentera follows a continuous loop:

1. **Learn:** Import the website, social profiles, documents, and connected systems, or accept a plain-language description.
2. **Find:** Identify repetitive work and rank opportunities by impact, confidence, and risk.
3. **Set up:** Configure the required AI, knowledge, tools, and connections behind the scenes.
4. **Put to work:** Ask only for the access or approval required to start producing an outcome.
5. **Prove and improve:** Show completed work, time saved, exceptions, and the next useful opportunity.

The interface begins with outcomes such as “answer customer enquiries” or “manage bookings,” never a blank agent or workflow builder.

## Operational Visibility

**Chat is where the owner asks. Activity is where the owner understands what happened.** A conversation transcript must never be the primary system of record.

Every instruction, proactive job, and external action automatically becomes a structured business record. At a glance, the owner should see the outcome, status, channel, time, exception or approval required, and estimated time saved. Repeated work is grouped into useful summaries—for example, “18 Telegram enquiries handled, 2 bookings created, 1 escalated”—instead of displayed as dozens of messages or tool calls.

Each product surface has one job:

- **Ask Jentera:** give instructions and ask questions.
- **Home:** see an automatic daily summary, exceptions, and the next useful action.
- **Activity:** trace completed, active, failed, and approval-blocked work as structured records.
- **Customer inbox:** read or take over actual customer conversations.
- **My Business:** review knowledge, permissions, connections, and automation policies.

Owner-facing summaries should lead with business outcomes. Raw messages, retrieved sources, model details, tool calls, and execution logs remain available under an expandable technical trace for support, debugging, and accountability.

## Language Principles

- Say **put Jentera to work**, not “deploy an agent.”
- Say **handle this task**, not “build a workflow.”
- Say **connect your tools**, not “configure integrations.”
- Show what Jentera is ready to do, what approval it needs, and what it completed.
- Summarize repeated actions into business outcomes instead of exposing a stream of agent messages.
- Keep models, prompts, APIs, orchestration, and implementation details behind the curtain.

## Trust and Control

Zero technical setup does not mean zero control. Jentera may automate low-risk internal work, but customer-facing or sensitive actions require appropriate approval and guardrails. The customer should always be able to review the business profile, permissions, activity, and outcomes.

## Primary Success Metric

Optimize for **time to first useful work completed**, not onboarding completion, agents created, or workflows configured.

The first proof of this promise is a complete loop: import the business, build reviewable memory, ask or instruct Jentera, approve a proposed action, execute it through a connected channel, and record the outcome.
