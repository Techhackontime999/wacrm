# Problems Remaining After `final_plan01.md` (v1.1)

The v1.1 corrections fixed the 20 issues from `problem.md`. 11 **new or still-present** issues remain.

---

## 🟠 Medium

### R1. A7 Cache Key Missing `isFirstInbound` Parameter

The cache key is `${userId}:${normalizeCacheKey(message.text)}` but `findEntryFlow` also uses `isFirstInbound` to match `first_inbound_message`-triggered flows. Two messages with identical text but different `isFirstInbound` values will hit the same cache entry, potentially returning the wrong flow.

**Example:**
1. Contact's first message "hello" → `isFirstInbound=true` → cache stores `flow_A` (a `first_inbound_message` flow)
2. Next message "hello" → `isFirstInbound=false` → cache returns `flow_A` (WRONG — should be `flow_B` keyword flow or `null`)

**Fix:** Include `isFirstInbound` in cache key: `` `${userId}:${+isFirstInbound}:${normalizeCacheKey(message.text)}` ``

---

### R2. `callAi()` Doesn't Support JSON Response Format

`src/lib/ai/provider.ts:callAi()` has no `response_format` parameter. The OpenAI-compatible API supports `response_format: { type: "json_object" }` for guaranteed JSON output, but `callAi()` doesn't expose it. Without it, the AI may return non-JSON text despite the prompt instruction "Return ONLY valid JSON."

**Impact:** C1 step 8 says "request JSON response format" but the actual API call doesn't enforce it. The `JSON.parse` in step 9 can crash.

**Fix:** Add an optional `responseFormat?: { type: "json_object" }` parameter to `callAi()`, or make the raw fetch call directly in the new route.

---

## 🟡 Low

### R3. Template ID Not Available in AI Prompt (C1)

The AI response format returns `{"type":"template","name":"...","params":[...]}` — only the template NAME. But the `AiReplyResponse.template_recommendation` interface requires an `id` field. The server must look up the template by name after the AI responds. This extra DB query is mentioned ("fetch its body_text server-side") but the ID lookup isn't explicitly stated.

---

### R4. Hardcoded 1024 `max_tokens` May Truncate AI Reply (C1)

`callAi()` hardcodes `max_tokens: 1024`. Combined with the system prompt + 10 messages + template list + flow list, the available tokens for the actual reply may be limited. A long suggested reply could be cut off mid-sentence.

**Fix:** Consider increasing `max_tokens` to 2048 for the AI reply endpoint (keep 1024 for the automation chat which needs shorter responses).

---

### R5. JSON Parsing Needs Robust Extraction (C4)

Without `response_format` API enforcement (see R2), the AI may wrap JSON in markdown code blocks:
```
```json
{"type":"reply","text":"Hello"}
```
```

Or add preamble: "Here is my suggestion: `{\"type\":...}`"

The plan says "try-catch `JSON.parse`" but doesn't include a markdown code block stripper or regex fallback.

**Fix:** Add a `tryExtractJson(raw: string)` helper that strips markdown code fences before parsing.

```ts
function tryExtractJson(raw: string): unknown {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw]
  try { return JSON.parse(jsonMatch[1].trim()) } catch { return null }
}
```

---

### R6. `redisSafe` Parameter Name Collision (B0)

```ts
import Redis from 'ioredis'  // <-- type import

export async function redisSafe<T>(
  fn: (redis: Redis) => Promise<T>,  // <-- shadows the imported type
  fallback: T,
): Promise<T>
```

The callback parameter `redis` shadows the imported `Redis` module. Not a runtime error but poor readability.

**Fix:** Rename to `client` or `r`:
```ts
fn: (client: Redis) => Promise<T>
```

---

### R7. `flows/meta-send.ts` Has Two Separate Loop Patterns (B3)

The plan documents that `flows/meta-send.ts` has both `engineSendText` (own loop) and `sendInteractiveViaMeta` (shared wrapper). The phone cache integration must be applied to **both** independently. The plan says "adapt per file" but doesn't show the dual-integration.

---

### R8. B5 Scheduler Initialization Unspecified

`processDuePendings()` is a module-level recursive `setTimeout` function, but the plan doesn't specify WHERE it's first called. Options:
- Cron endpoint (but it returns HTTP response)
- Server startup script
- Module-level invocation

Each has trade-offs. Without an explicit initialization plan, implementers may wire it wrong.

---

### R9. A2 Mode Confusion: "After" Shows Parallel but "Default" Is Serial

The plan shows the parallel `Promise.allSettled` version as the "After" code block, but then says "serial is the safe default." This contradictory presentation may lead implementers to pick the wrong mode without understanding the race conditions.

---

### R10. C2 AI Callbacks Require 3-Level Prop Drilling

Callbacks flow: `MessageThread` → `MessageComposer` → `AiReplyButton`. Three components are touched for a single feature. Consider React context or a dedicated hook for AI reply state.

---

### R11. A7 Cache Tests Need Supabase Mock

The test plan lists "Entry flow cache hits/misses/expiry" for `flows/engine.test.ts`, but the cache is embedded inside `findEntryFlow` which also does Supabase queries. The existing engine tests test pure functions — cache testing requires mocking Supabase, which the plan doesn't address.

---

## Summary

| Status | Count | IDs |
|--------|-------|-----|
| 🟠 Still present | 2 | R1 (cache bug), R2 (no JSON response format) |
| 🟡 Nuance missing | 9 | R3–R11 |
| ✅ Fixed from v1 | 20 | P1–P20 |

**R1 is the only correctness bug** — the A7 cache key must include `isFirstInbound`. R2 risks JSON parsing failures. The rest are design/documentation gaps that won't cause runtime failures in common cases.
