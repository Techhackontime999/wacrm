# Problems When Implementing `final_plan.md`

## 🔴 Critical — Will Break or Cause Data Loss

### P1. Redis Commands Throw on Connection Drop (B0, B1, B2, B3, B4)

`getRedis()` initializes with `lazyConnect: true`. Once `client` is set (non-null), it stays non-null **even if Redis later goes down**. Every subsequent Redis operation (`incr`, `set`, `get`, `del`, `expire`, `zadd`) rejects with an unhandled promise rejection. The `client.on('error')` handler only logs — it does not prevent individual commands from throwing.

**Where it hits:** `checkRateLimitWithRedis`, webhook dedup (B2), phone cache helpers (B3), Redis entry flow cache (B4), real-time wait steps (B5).

**Fix:** Wrap every Redis command in try-catch OR add a connection health check that returns `null` from `getRedis()` when the connection is lost.

---

### P2. Phone Variant Pattern Differs Across 3 Files (B3)

The plan says "same pattern in each" but the actual code diverges:

| File | Functions | Structure |
|------|-----------|-----------|
| `automations/meta-send.ts` | `engineSendText`, `engineSendTemplate` | Shared `sendViaMeta()` wrapper |
| `flows/meta-send.ts` | `engineSendText`, `engineSendInteractiveButtons`, `engineSendInteractiveList` | `engineSendText` has its own loop; `sendInteractiveViaMeta` has another; 2 separate patterns |
| `send/route.ts` | POST handler | Inline loop with `sanitizedPhone` → `workingPhone` persistence |

**Also missed:** `broadcast/route.ts` has its own phone-variant loop but the plan doesn't include it. And none of the files use `await getCachedPhone()` / `await setCachedPhone()` — these are new functions that must be integrated into each loop differently.

---

### P3. AI Reply Text Parsing Is Unreliable (C4)

The plan uses a CLI-style text format:
```
TEMPLATE: name | param1 | param2
FLOW: name | trigger | resume
REPLY: your suggestion text
```
LLMs consistently fail at exact text formatting: extra whitespace, conversational preamble ("Here you go: REPLY: Sure!"), wrong delimiters, markdown interference. A JSON structured output or function-calling approach would be far more robust.

---

### P4. Token Budget Overflow (C1)

`max_tokens` is set to `1024` via `callAi()`. The plan fetches ALL approved templates (with full `body_text`) and ALL active flows to include in the system prompt. A user with 20+ templates could easily exceed the context window, causing the AI to truncate or fail.

**Fix:** Summarize templates (name only, not body_text), limit to top N, or use a multi-turn approach.

---

### P5. Parallel Automations Race Conditions (A2)

Converting `for` → `Promise.allSettled` introduces several races:

- **Log ordering:** `automation_logs` rows inserted concurrently; no deterministic ordering
- **Execution counter:** `increment_automation_execution_count` RPC is per-automation (safe), but each call could interleave with another
- **Shared resource writes:** Two automations on the same trigger could update the same contact/conversation simultaneously (tags, fields, deals, conversation assignment)
- **Wait step concurrency:** If both automations reach a wait step, two `automation_pending_executions` rows are created — the cron resumes both independently

The plan's "acceptable because automations are independent" assumption must be verified per-installation.

---

## 🟠 Medium — Wrong Behavior or Blockers

### P6. `findOrCreateContact` Exact Match Throws on Duplicate (A4)

The plan's exact match uses `.maybeSingle()`. If `idx_contacts_user_phone` doesn't exist (Phase 1 skipped) and there are duplicate `(user_id, phone)` rows, `.maybeSingle()` **throws an error** on >1 row — crashing the webhook for that message. The phased ordering (index first) mitigates this, but it's a fragile dependency.

---

### P7. Webhook Dedup TOCTOU Race (B2)

The Redis SET NX check passes for both duplicate webhooks if neither has started processing yet (the first hasn't inserted the key before the second checks). This is a classic time-of-check-time-of-use race. The 30-second TTL reduces the window but doesn't eliminate it.

---

### P8. `aiReply` Rate Limit Key Not Async-Safe (C1)

The plan adds `aiReply` to `RATE_LIMITS` but the AI reply route's rate check should use `checkRateLimitWithRedis` (the async wrapper). The plan doesn't specify how to bridge the sync→async gap. The route handler is already async, so `await checkRateLimitWithRedis(...)` would work, but the fallback to the sync `checkRateLimit` inside the async function is handled differently from the plan's pseudocode.

---

### P9. MessageComposer State Bloat (C2)

The plan adds AI loading, suggestion, template recommendation, flow suggestion, and action chips to `MessageComposer` (currently 155 lines, very focused). This doubles the component's concerns. Better extracted into a sub-component or custom hook.

**Current composer state:** `text`, `sending`
**Planned additional state:** `aiLoading`, `aiSuggestion`, `templateRecommendation`, `flowSuggestion`, chip visibility

---

### P10. `resolveConversationId` Cache Already Partially Exists (A3)

The current `resolveConversationId` ALREADY checks `args.context.conversation_id` first (line 463-464). The webhook ALREADY sets `conversation_id` in the context (line 648-650). The A3 optimization only helps in two cases:
1. Resumed executions (context serialized through `automation_pending_executions`)
2. Manual engine API calls without a `conversation_id` in context

This is a minor optimization, not the "DRAMATIC" improvement the plan implies.

---

### P11. `.env.local.example` Path Wrong (B0)

Plan says `src/.env.local.example` but the actual file is at project root: `.env.local.example`.

---

### P12. Template Status Values May Not Match (C1)

The plan filters `status = 'Approved'`. The TypeScript type says `'Draft' | 'Pending' | 'Approved' | 'Rejected'`. But WhatsApp Meta API uses `APPROVED` (uppercase). The actual DB values depend on the sync logic and may be uppercase.

---

### P13. Broadcast Route Has Un-cached Phone Variant Loop (B3)

`broadcast/route.ts` has its own phone-variant retry loop but is NOT in the plan's B3 scope. It should either be included or explicitly documented as out of scope.

---

### P14. `ioredis` + TypeScript v6 Compatibility

The project uses `typescript: ^6`. `ioredis@^5.6` may lack type definitions compatible with TS v6. May need `@types/ioredis` or type overrides. Check `npx tsc --noEmit` after install.

---

## 🟡 Low — Edge Cases & Cleanliness

### P15. "Poor Man's LRU" Is Actually FIFO (A7)

`entryFlowCache.keys().next().value` deletes the oldest **inserted** entry, not the least recently **used** entry. This is FIFO eviction. With 5s TTL and 100 max entries, it doesn't matter in practice, but the documentation is misleading.

---

### P16. Entry Flow Cache Key Ignored Normalization (A7)

Cache key is `${userId}:${message.text.toLowerCase()}`. Does NOT normalize whitespace, punctuation, or unicode. `"Hello "` and `" hello"` are different cache keys. With 5s TTL this is minor, but for higher-quality dedup, trim + collapse whitespace.

---

### P17. Module-Level Entry Flow Cache in Next.js Dev Mode (A7)

`const entryFlowCache = new Map()` at module scope is fine in production, but lost on every hot-reload in dev mode. This is expected behavior but worth noting.

---

### P18. No Tests for New Code

The project has `vitest` configured with existing tests (`rate-limit.test.ts`, `engine.test.ts`, `fallback.test.ts`, etc.). The plan introduces significant new modules (`redis/client.ts`, `redis/helpers.ts`, `ai/reply-prompt.ts`, `api/ai-reply/suggest/route.ts`) without mentioning test coverage.

---

### P19. Rate Limit Key Name Convention Mismatch

Existing keys: `send`, `broadcast`, `react` (all lowercase). Plan adds `aiReply` (camelCase). Should be consistent (`ai_reply` or `aiReply`).

---

### P20. B5 Real-Time Wait Steps Only Works in Long-Running Processes

The `setTimeout(processDuePendings, 1000)` scheduler is fine for self-hosted VPS but **will not work** on serverless platforms (Vercel, Netlify) where the function is ephemeral. The plan marks this as "deferred" and "medium risk" — this limitation should be explicit.

---

## Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| 🔴 Critical | 5 | P1 (Redis crash), P2 (3 divergent patterns), P3 (AI parsing), P4 (token budget), P5 (parallel races) |
| 🟠 Medium | 9 | P6-P14 |
| 🟡 Low | 6 | P15-P20 |

**Recommended pre-flight:**
1. Wrap all Redis operations in try-catch (`getRedis` helper → safe wrapper)
2. Audit all 4 phone-variant loop locations before touching B3
3. Use JSON output mode instead of free-text parsing for AI reply
4. Add a max-token guard on the AI reply prompt builder
5. Write tests before merging new modules
