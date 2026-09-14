# Cache baseline and isolated prefix experiment

Measured 14 September 2026, Malaysia time. No live configuration, tools,
skills, or customer conversations changed. Six synthetic completions were
sent through the owner's existing Jentera model proxy, with tools absent,
thinking disabled and output capped at 64 tokens. No agent/tool execution.

## Production baseline before the experiment

Owner rider, direct `deepseek-flash`, tool_count > 0, preceding 24 hours:

- 25 recorded calls, 1,321,446 prompt tokens, 1,107,712 cached tokens (83.8%).
- 17,825 output tokens; maximum prompt 94,188 tokens.
- Average system 29,578 characters; tools 48,918 characters; history 117,945 characters.
- These are recorded model calls, not a task-quality benchmark or invoice.

At the configured 1,048,576-token context size, a 0.20 compression threshold
is about 209,715 tokens, above every prompt in this sample. This does not
establish that compression is unnecessary in other sessions, nor test any
information loss from earlier compression.

## Synthetic A/B

One generated list of 100 fictional products; ask for product TEST-042's
7-day lead time and 10-unit minimum. Each call gets a fresh request marker.
Stable variant places the marker after the shared system context; changing
variant places it before. Interleaved three rounds, with three seconds
between rounds. Same model and question; no temperature override.

| Variant | Round | Input | Cached | Seconds | Output tokens |
|---|---:|---:|---:|---:|---:|
| Stable prefix | 1 | 2,271 | 0 | 1.750 | 14 |
| Changing prefix | 1 | 2,273 | 0 | 1.611 | 21 |
| Stable prefix | 2 | 2,275 | 2,048 | 1.313 | 14 |
| Changing prefix | 2 | 2,277 | 0 | 1.126 | 14 |
| Stable prefix | 3 | 2,271 | 2,048 | 1.611 | 14 |
| Changing prefix | 3 | 2,276 | 0 | 1.623 | 14 |

All six replies contained both expected numeric answers. This is only a
simple fact-retrieval check, not evidence of unchanged complex-task quality.

Using the application's conservative peak rates ($0.30/M uncached input,
$0.006/M cached input, $1.20/M output), estimated costs including cold calls:
stable $0.000891276; changing $0.002106600 — about 58% less for stable.
Warm rounds alone: about 86% less. Combined estimate: under $0.003.
These are estimates, not invoiced cost; actual off-peak pricing may be lower.
There is no consistent latency improvement in this tiny sample.

Evidence: `/tmp/fleet-exec-20260913T160121Z/aisar-b-c679d9df0aaa77ba1ec7.log`.
Diagnostic source: `/tmp/jentera-cache-ab.sh` (no embedded credentials).

## Conclusion and limits

Stable prefixes demonstrably preserve cache reuse. The recently deployed
prompt ordering should remain. We have not A/B tested tool/skill removal or
compression quality, and no such change should be described as proven safe.
A next isolated test should use a fixed set of research, document, reminder
and image tasks, compare uncached input and correctness, and include facts
that must survive compression. Do not change the owner's runtime to conduct it.
