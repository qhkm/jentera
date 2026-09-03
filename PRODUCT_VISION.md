# Jentera Product Vision

## Elevator pitch

Jentera deploys AI workers for Southeast Asian businesses.

Instead of asking a business owner to set up servers, install agent frameworks, manage API keys, connect tools, or build automations themselves, Jentera gives them a ready-to-use AI worker that can actually operate inside their business.

Each business gets a persistent cloud computer where its AI agents can run continuously. The agents can use a browser, terminal, files, scheduled tasks, memory, and business software — similar to the new generation of computer-using agents. But the computer is not the differentiation.

> **Grok gives AI a computer. Jentera gives AI access to your business.**

Jentera builds the integration layer between AI agents and the software Southeast Asian businesses actually use: accounting systems, invoicing, e-commerce, POS, banking workflows, messaging platforms, government systems, and local SaaS products.

The customer should not have to understand Hermes, MCP, APIs, VPSs, tokens, or infrastructure. They simply tell Jentera what needs to be done.

## The Problem

Most AI and automation products still sell a toolbox. Customers must understand agents, prompts, models, APIs, integrations, triggers, testing, and maintenance. No-code products remove programming but often leave the implementation decisions with the customer.

Powerful general-purpose agent frameworks already exist. The missing layer is access to the systems Southeast Asian businesses actually use. Many regional SaaS products still:

- have limited APIs;
- don't expose MCP servers or agent-friendly CLIs;
- require manual browser workflows;
- have fragmented, highly localized documentation;
- are built country-by-country.

At the same time, millions of SMEs are not going to deploy Hermes, configure servers, write MCP servers, or orchestrate agents themselves. Jentera bridges those two gaps: it takes powerful general-purpose AI agents and turns them into workers that can operate inside a real Southeast Asian business.

## How it works

A business gets one workspace (its Business Computer, persistently running) and deploys the AI workers it needs:

| Layer | What it is |
|---|---|
| Business | The company that owns the workspace |
| Jentera Workspace / Business Computer | Persistent cloud computer, always on |
| AI Workers | Accounts, Sales, Customer Support, Operations agents |
| Jentera Business Tool Layer | Bukku, AutoCount, SQL Account, MyInvois, WhatsApp, StoreHub, Shopee, Lazada, TikTok Shop, local banks, local SaaS — eventually hundreds of SEA business tools |

For example, a Malaysian SME could deploy a Jentera Accounts Agent that can:

- check transactions in Bukku;
- reconcile payments against the bank;
- create or verify invoices;
- interact with MyInvois;
- prepare reports;
- chase missing payments;
- notify the owner through WhatsApp or Telegram.

Other agents handle sales, customer support, and operations — all running from the same business workspace. Underneath, Jentera manages the agent runtime, cloud computer, models, credentials, integrations, permissions, memory, and execution environment.

## Ideal Customer Profile

The primary customer is a non-technical small-business owner or operator who:

- knows AI could help but does not know where to begin;
- runs repetitive customer-service or operational processes;
- already works through tools such as WhatsApp, Telegram, Instagram, email, calendars, spreadsheets, a POS, or a basic CRM;
- has no internal AI or automation team;
- values a working outcome more than a configurable platform.

Jentera is built for business owners, not developers.

## Managed Autonomy

Jentera provides the capability of a powerful autonomous agent — persistent memory, tools, reusable skills, scheduled work, delegation, multi-channel messaging — as a managed service. Owners never have to install an agent, select a model, manage API keys, configure tools, or maintain infrastructure.

The underlying agent runtime is replaceable. Jentera owns the durable business layer around it: verified business knowledge, permissions, integrations, approvals, audit history, reliability, and the non-technical customer experience.

## Product Portfolio: Workers + Connect

Jentera has two products that reinforce each other.

### 1. Jentera Workers

AI workers that small businesses can deploy without technical setup.

> “Hire an AI worker for your business.”

The managed SMB experience outlined above. Internally it runs on the Business Computer with the shared trust and operations layer (identity, permissions, credentials, approvals, budgets, observability, audit history). Externally the customer works with one or more named workers, not a platform.

### 2. Jentera Connect

A unified, agent-native interface for Southeast Asian business software. The tool layer as a standalone infrastructure product.

> “One interface for AI agents to operate business software across Southeast Asia.”

Other AI agent frameworks, developers, and automation companies could use Jentera's APIs, MCP servers, or CLI to interact with Southeast Asian software without building every integration themselves.

**Workers is the distribution engine for Connect; Connect is the infrastructure moat underneath Workers.**

### Portfolio sequence

1. Prove the Business Computer and the shared trust/operations layer through the current managed-work product.
2. Develop Connect around a small number of excellent Southeast Asian integrations; make its contracts independent of the hosted runtime.
3. Add a unified data layer to Connect: account linking, canonical models, normalized reads/writes, webhooks, synchronization, connection health — the [Merge Unified](https://www.merge.dev/unified-api) model applied to regional business software, extended with agent-native actions, policies, approvals, and regional business procedures.
4. Expose those capabilities agent-natively (API, SDK, MCP, eventually CLI) with higher-level regional business procedures.
5. Package repeatable outcomes as ready-to-use workers for non-technical businesses.
6. Add a marketplace layer only when external supply and demand justify a distribution product.

Connect must not delay the first complete useful-work loop.

## Business Model

Jentera does not sell unlimited AI.

**Base model:** monthly platform subscription + included usage + additional usage when needed.

| Tier | Price | What's included |
|---|---|---|
| BYOK | RM79/month | Customer brings their own OpenAI, Anthropic, Gemini, or OpenRouter account; Jentera provides the cloud computer, agent runtime, integrations, deployment, management |
| Starter | RM99/month | Managed AI with a limited amount of included compute and AI usage |
| Business | RM199+/month | More usage, automations, integrations, agents, permissions, business workflows |

Heavy usage is billed separately through Jentera Credits. This protects Jentera from unpredictable token and compute costs while keeping entry pricing comparable to products such as Grok Bot.

Internally, Jentera tracks the true cost of every business — sprite compute + AI tokens + messaging/API costs + third-party tools — with a target gross margin of roughly 70–80%.

## Product Experience

Jentera follows a continuous loop:

1. **Learn:** Import the website, social profiles, documents, and connected systems, or accept a plain-language description.
2. **Find:** Identify repetitive work and rank opportunities by impact, confidence, and risk.
3. **Set up:** Configure the required AI, knowledge, tools, and connections behind the scenes.
4. **Put to work:** Ask only for the access or approval required to start producing an outcome.
5. **Prove and improve:** Show completed work, time saved, exceptions, and the next useful opportunity.

The interface begins with outcomes such as “answer customer enquiries” or “manage bookings,” never a blank agent or workflow builder.

### Operational visibility

**Chat is where the owner asks. Activity is where the owner understands what happened.** A conversation transcript must never be the primary system of record.

Every instruction, proactive job, and external action automatically becomes a structured business record. At a glance, the owner should see the outcome, status, channel, time, exception or approval required, and estimated time saved. Repeated work is grouped into useful summaries — for example, “18 Telegram enquiries handled, 2 bookings created, 1 escalated” — instead of displayed as dozens of messages or tool calls.

Each product surface has one job:

- **Ask Jentera:** give instructions and ask questions.
- **Home:** see an automatic daily summary, exceptions, and the next useful action.
- **Activity:** trace completed, active, failed, and approval-blocked work as structured records.
- **Customer inbox:** read or take over actual customer conversations.
- **My Business:** review knowledge, permissions, connections, and automation policies.

Owner-facing summaries lead with business outcomes. Raw messages, retrieved sources, model details, tool calls, and execution logs remain available under an expandable technical trace for support, debugging, and accountability.

## Language Principles

- Say **put Jentera to work**, not “deploy an agent.”
- Say **handle this task**, not “build a workflow.”
- Say **connect your tools**, not “configure integrations.”
- Show what Jentera is ready to do, what approval it needs, and what it completed.
- Summarize repeated actions into business outcomes instead of exposing a stream of agent messages.
- Keep models, prompts, APIs, orchestration, and implementation details behind the curtain.
- Marketing may use **“Hire an AI worker for your business”** for the Workers product; **“One interface for AI agents to operate business software across Southeast Asia”** for Connect.

## Trust and Control

Zero technical setup does not mean zero control. Jentera may automate low-risk internal work, but customer-facing or sensitive actions require appropriate approval and guardrails. The customer should always be able to review the business profile, permissions, activity, and outcomes.

## Long-Term Vision

Today:

> Deploy an AI worker for your business.

Later:

> The execution layer connecting AI agents to Southeast Asian businesses.

Eventually, any AI agent — built with Hermes, OpenAI, Claude, Grok, or another framework — could use Jentera to access regional business infrastructure.

The long-term value of Jentera is not the model and not the virtual machine. It is the execution and integration layer between AI and the real-world business systems of Southeast Asia.

## Primary Success Metric

Optimize for **time to first useful work completed**, not onboarding completion, agents created, or workflows configured.

The first proof of this promise is a complete loop: import the business, build reviewable memory, ask or instruct Jentera, approve a proposed action, execute it through a connected channel, and record the outcome.
