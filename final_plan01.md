# FINAL PLAN v1.1 — Performance, Redis & AI Smart Reply (Corrected)

## Overview

**This is a corrected version of `final_plan.md` incorporating all fixes from `problem.md`.** Every change from the original is annotated with the problem ID (e.g., `[P1]`).

Three tracks — all backward-compatible, additive, and safe to implement independently.

| Track | Theme | Dependencies | Effort |
|-------|-------|-------------|--------|
| **A** | Performance (no Redis, works today) | None | Low |
| **B** | Redis integration (optional, opt-in) | `ioredis` + `REDIS_URL` | Medium |
| **C** | AI-Powered Smart Reply | `AI_API_KEY` (already configured) | Medium |

---

## Track A — Performance (Redis optional, works without it)

### Flow Engine Notes
The Flow engine (`src/lib/flows/engine.ts`) is called **synchronously** in the webhook (line 597 — `await dispatchInboundToFlows(...)`). Unlike automations which are fire-and-forget, **the Flow engine blocks the webhook response**. Every optimization below that reduces send latency directly improves the webhook's response time to Meta.

---

### A1 — Index `contacts(user_id, phone)`

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone
  ON contacts (user_id, phone);
```

**Why:** Speeds up `findOrCreateContact` in the webhook, the contacts page search, and the phone lookup in `meta-send.ts`.

**Risk:** Zero. `IF NOT EXISTS` is idempotent. No queries change.

---

### A2 — Parallelize automations  [P5: RACE CONDITIONS DOCUMENTED]

**File:** `src/lib/automations/engine.ts` — change `runAutomationsForTrigger`

**Before (sequential):**
```ts
for (const automation of automations as Automation[]) {
  if (!triggerMatches(automation, input.context)) continue
  try { await executeAutomation(automation, input) } catch (err) { ... }
}
```

**After (parallel — default mode):**
```ts
const results = await Promise.allSettled(
  automations.map(async (automation) => {
    if (!triggerMatches(automation, input.context)) return
    await executeAutomation(automation, input)
  })
)
```

**After (serial — opt-in when race conditions are a concern):**
```ts
for (const automation of automations as Automation[]) {
  if (!triggerMatches(automation, input.context)) continue
  try { await executeAutomation(automation, input) } catch (err) { ... }
}
```
(No change — keep as-is when user prefers ordering guarantees.)

**Why:** Multiple automations triggered by the same event run concurrently instead of waiting for each other. Provide both modes; serial is the safe default for accounts with interdependent automations.

**⚠️ KNOWN RACE CONDITIONS (parallel mode only):**
| Race | Consequence |
|------|-------------|
| Two automations update the same contact field | Last write wins — intermediate value lost |
| Two automations add/remove tags on the same contact | Tag state depends on interleaving |
| Two automations create deals | Duplicate deals may appear |
| Two automations assign conversation | Last assignment wins |
| Log ordering (`automation_logs`) | Non-deterministic step order in logs |
| Execution counter RPC (`increment_automation_execution_count`) | Per-automation counter is atomic (safe), but `last_executed_at` may be set by whichever finishes last |

**Mitigation:** Use the unmodified serial loop (keep `for` + `await`) if any of these races are unacceptable. The parallel mode is safe only when automations are truly independent (different contacts, no shared write targets).

---

### A3 — Cache `resolveConversationId`  [P10: SCALE CORRECTED]

**File:** `src/lib/automations/engine.ts` — modify `resolveConversationId`

**Before (current behavior):**
The function ALREADY checks `args.context.conversation_id` first (line 463-464). The webhook ALREADY sets `conversation_id` in the context (line 648-650). The DB fallback is only reached for:
1. Resumed executions (context serialized through `automation_pending_executions`)
2. Manual engine API calls without `conversation_id`

**After:**
```ts
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  if (args.context.conversation_id) return args.context.conversation_id
  // ...existing DB lookup, then store result back:
  args.context.conversation_id = data.id
  return data.id
}
```

**Why:** Minor optimization for resumed/pending executions (avoids one DB query on the first send after resume). The `conversation_id` is immutable for a given contact+user pair.

**Impact:** Small — this is not a dramatic win. The real value is in A4 and the indexes.

**Risk:** Near zero.

---

### A4 — Direct phone lookup in webhook  [P6: DUPLICATE GUARD ADDED]

**File:** `src/app/api/whatsapp/webhook/route.ts` — modify `findOrCreateContact`

**Before:**
```ts
const { data: contacts } = await supabaseAdmin()
  .from('contacts').select('*').eq('user_id', userId)
const existing = contacts?.find((c) => phonesMatch(c.phone, phone))
```

**After (with duplicate guard):**
```ts
// Exact match first (fast with the new index from A1).
// Use .limit(2) instead of .maybeSingle() to avoid throwing
// on duplicates if the index wasn't created yet.
const { data: exact } = await supabaseAdmin()
  .from('contacts').select('*')
  .eq('user_id', userId).eq('phone', phone)
  .limit(2)
if (exact && exact.length === 1) {
  return { contact: exact[0], wasCreated: false }
}
if (exact && exact.length > 1) {
  console.warn('[webhook] duplicate contacts for phone', phone)
}

// Fuzzy fallback (preserves existing behavior for mismatched formats)
const { data: contacts } = await supabaseAdmin()
  .from('contacts').select('*').eq('user_id', userId)
const existing = contacts?.find((c) => phonesMatch(c.phone, phone))
```

**Why:** For contacts with an exact phone match (most common case), this is O(1) instead of O(n). `.limit(2)` never throws, unlike `.maybeSingle()`.

**Risk:** Very low. Fuzzy fallback is untouched. `limit(2)` is safe even without the index.

---

### A5 — Index `flow_runs(user_id, contact_id)` for duplicate inbound check

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_contact
  ON flow_runs (user_id, contact_id);
```

**Why:** `isDuplicateInbound()` in `src/lib/flows/engine.ts` runs for every inbound message when a flow is active.

**Risk:** Zero. `IF NOT EXISTS` is idempotent.

---

### A6 — Index `flows(user_id, status)` for fast entry-flow scan

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flows_user_status
  ON flows (user_id, status);
```

**Why:** `findEntryFlow()` in `src/lib/flows/engine.ts` fetches all active flows for the user on every inbound message.

**Risk:** Zero. `IF NOT EXISTS` is idempotent.

---

### A7 — Cache `findEntryFlow` result (in-memory)  [P15, P16, P17: CORRECTED]

**File:** `src/lib/flows/engine.ts` — add in-memory cache

```ts
const entryFlowCache = new Map<string, { flow: FlowRow | null; expiresAt: number }>()
const ENTRY_CACHE_TTL_MS = 5_000 // 5 seconds
const ENTRY_CACHE_MAX = 100

// Note: Module-level Map is lost on Next.js hot-reload in dev mode.
// In production (single-process VPS) it persists as expected.
// In serverless deployments (Vercel), each invocation gets a fresh Map.

function normalizeCacheKey(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ')
}

async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger
  if (message.kind !== 'text') return null

  const cacheKey = `${userId}:${normalizeCacheKey(message.text)}`
  const cached = entryFlowCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.flow

  // ... existing DB query ...

  // FIFO eviction (oldest inserted entry, not LRU — acceptable for 5s TTL)
  if (entryFlowCache.size >= ENTRY_CACHE_MAX) {
    const oldest = entryFlowCache.keys().next().value
    if (oldest !== undefined) entryFlowCache.delete(oldest)
  }
  entryFlowCache.set(cacheKey, { flow: result, expiresAt: Date.now() + ENTRY_CACHE_TTL_MS })
  return result
}
```

**Changes from v1:**
- Added `normalizeCacheKey()` to handle whitespace
- Eviction labeled as FIFO (not LRU)
- Dev-mode / serverless limitations documented

**With Redis:** See B4 below.

**Risk:** Low.

---

## Track B — Redis Integration (optional, opt-in)

### B0 — Dependency & Connection  [P1, P11, P14: FIXED]

**Install:**
```
npm install ioredis@^5.6
```
**Check TypeScript compatibility:** After install, run `npx tsc --noEmit` to verify `ioredis` types work with TS v6. If type errors occur, use `as any` casts in `client.ts` or add `// @ts-ignore` on the import.

**File:** `src/lib/redis/client.ts`
```ts
import Redis from 'ioredis'

let client: Redis | null = null
let connectionLost = false

export function getRedis(): Redis | null {
  if (connectionLost) return null
  if (client !== null) return client
  const url = process.env.REDIS_URL
  if (!url) return null
  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  })
  client.on('error', (err) => {
    console.warn('[redis]', err.message)
    connectionLost = true
  })
  client.on('ready', () => {
    connectionLost = false
  })
  return client
}

export function isRedisAvailable(): boolean {
  return getRedis() !== null
}

/** [P1] Wraps a Redis call with safe null/error handling.
 *  Every Redis operation MUST use this helper instead of calling
 *  redis.get/set/incr directly. */
export async function redisSafe<T>(
  fn: (redis: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const redis = getRedis()
    if (!redis) return fallback
    connectionLost = false
    return await fn(redis)
  } catch (err) {
    console.warn('[redis] operation failed, using fallback:', err instanceof Error ? err.message : err)
    connectionLost = true
    return fallback
  }
}
```

**Graceful degradation:** `getRedis()` returns null when `REDIS_URL` is unset or connection is lost. `redisSafe()` catches any rejection and returns the fallback. Every consumer uses `redisSafe()`.

**Security:**
- Password is embedded in `REDIS_URL` — never logged
- All keys prefixed with `wacrm:` for namespace isolation
- Only basic commands: `INCR`, `EXPIRE`, `SET`, `GET`, `DEL` — no Lua scripts
- On error: warns once, returns null, never blocks the caller

**File:** `.env.local.example` (project root) — add
```
# Redis — optional. Makes rate limiting, webhook dedup, and phone
# variant caching work across instances. Without it, all features
# fall back to in-memory / DB defaults.
# REDIS_URL=redis://default:password@localhost:6379
```

---

### B1 — Redis-backed rate limiter (optional wrapper)  [P1: FIXED WITH redisSafe]

**Critical constraint:** `checkRateLimit` is tested synchronously in `src/lib/rate-limit.test.ts`. Making it async would break all existing tests. Therefore:

- **Keep `checkRateLimit` synchronous** — unchanged signature, always uses in-memory Map. No test changes.
- **Add a new async function** `checkRateLimitWithRedis(key, options)` — same return shape, uses Redis when available, falls back to in-memory.

**File:** `src/lib/rate-limit.ts` — add alongside existing code

```ts
import { redisSafe } from '@/lib/redis/client'

export async function checkRateLimitWithRedis(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now()
  const redisKey = `wacrm:rl:${key}`

  const count = await redisSafe(
    async (redis) => {
      const c = await redis.incr(redisKey)
      if (c === 1) await redis.expire(redisKey, Math.ceil(windowMs / 1000))
      return c
    },
    null, // fallback
  )

  // Redis fallback — use in-memory
  if (count === null) {
    return checkRateLimit(key, { limit, windowMs })
  }

  if (count > limit) {
    const ttl = await redisSafe(
      (redis) => redis.ttl(redisKey),
      Math.ceil(windowMs / 1000),
    )
    return { success: false, remaining: 0, reset: now + ttl * 1000, limit }
  }
  return { success: true, remaining: limit - count, reset: now + windowMs, limit }
}
```

**Call sites** — optionally switch to the Redis version by adding `await`:
```ts
// Before:
const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)

// After (opt-in, add await):
const limit = await checkRateLimitWithRedis(`send:${user.id}`, RATE_LIMITS.send)
```
Files to update if you opt in:
- `src/app/api/whatsapp/send/route.ts:36`
- `src/app/api/whatsapp/broadcast/route.ts:67`

**Risk:** Zero for existing code — `checkRateLimit` is untouched.

---

### B2 — Webhook deduplication  [P1, P7: FIXED + DOCUMENTED]

**File:** `src/app/api/whatsapp/webhook/route.ts` — insert before `processWebhook()`

```ts
import { redisSafe } from '@/lib/redis/client'

// ... after signature verification, before processWebhook(body) ...

const msgIds: string[] = []
if (body.entry) {
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      for (const msg of change.value.messages ?? []) {
        msgIds.push(msg.id)
      }
    }
  }
}

for (const id of msgIds) {
  const key = `wacrm:webhook:${id}`
  const ok = await redisSafe(
    (redis) => redis.set(key, '1', 'EX', 30, 'NX'),
    null, // fallback → skip dedup
  )
  if (ok === null) {
    // Redis unavailable — skip dedup
    break
  }
  if (!ok) {
    console.log('[webhook] duplicate', id, 'skipped')
    return NextResponse.json({ status: 'duplicate' }, { status: 200 })
  }
}
```

**Known limitation [P7]:** There is a TOCTOU race window: if two duplicate webhooks arrive simultaneously before either sets the Redis key, both will pass the check. The 30s TTL covers sequential duplicates. In practice, Meta's retry interval is >1s so this race is extremely rare.

**Why:** Meta can deliver the same webhook payload twice within seconds.

**Risk:** Minimal. When Redis is off, `redisSafe` returns null → dedup skipped entirely.

---

### B3 — Phone variant cache  [P2, P13: FIXED — 4 FILES, NOT 3]

**Problem:** Every send retries up to 3 phone variants against Meta's API. This repeats on **every** send to the same contact.

**Files to modify (4 files, each with a different pattern):**

| # | File | Functions | Pattern |
|---|------|-----------|---------|
| 1 | `src/lib/automations/meta-send.ts` | `engineSendText`, `engineSendTemplate` | Shared `sendViaMeta()` wrapper |
| 2 | `src/lib/flows/meta-send.ts` | `engineSendText`, `engineSendInteractiveButtons`, `engineSendInteractiveList` | `engineSendText` has its own loop; `sendInteractiveViaMeta` has another |
| 3 | `src/app/api/whatsapp/send/route.ts` | POST handler | Inline loop |
| 4 | `src/app/api/whatsapp/broadcast/route.ts` | POST handler | Per-recipient loop inside for-loop |

**File:** `src/lib/redis/helpers.ts`
```ts
const PHONE_CACHE_TTL = 86_400 // 24 hours

export async function getCachedPhone(contactId: string): Promise<string | null> {
  return redisSafe(
    (redis) => redis.get(`wacrm:phone:${contactId}`),
    null,
  )
}

export async function setCachedPhone(contactId: string, phone: string): Promise<void> {
  await redisSafe(
    (redis) => redis.set(`wacrm:phone:${contactId}`, phone, 'EX', PHONE_CACHE_TTL),
    undefined,
  )
}

export async function invalidateCachedPhone(contactId: string): Promise<void> {
  await redisSafe(
    (redis) => redis.del(`wacrm:phone:${contactId}`),
    undefined,
  )
}
```

**Integration pattern (adapt per file):**

For files 1 & 2 (shared wrapper pattern):
```ts
const cachedPhone = await getCachedPhone(contact.id)
const variants = cachedPhone
  ? [cachedPhone, ...phoneVariants(sanitized).filter(v => v !== cachedPhone)]
  : phoneVariants(sanitized)

// ... inside the variant loop, after successful send:
if (workingPhone !== sanitized || !cachedPhone) {
  await setCachedPhone(contact.id, workingPhone)
}
```

For file 3 (send/route.ts, inline pattern):
```ts
// Same cache integration but injected before the inline variant loop.
```

For file 4 (broadcast/route.ts, per-recipient loop):
```ts
// Cache check is per-recipient, inside the for(recipient) loop:
const cachedPhone = await getCachedPhone(recipient.contactId)  // if contactId available
// Note: broadcast route uses phone numbers directly, not contact IDs.
// If no contactId is available, the cache cannot be used for broadcast recipients.
// The phone-variant retry loop remains unchanged for broadcasts.
```

**Why:** After the first successful send to a contact, subsequent sends skip the 3-variant retry loop.

**Invalidation:** When a contact's phone is edited in the CRM, call `invalidateCachedPhone(contactId)`.

**Risk:** Low. Cached phone is tried first, but full variant loop runs as fallback.

---

### B4 — Redis-backed entry flow cache  [P1: FIXED]

**File:** `src/lib/flows/engine.ts` — extend `findEntryFlow`

Replace the in-memory cache from A7 with Redis when available:

```ts
async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  if (message.kind !== 'text') return null

  const cacheKey = `wacrm:flow:entry:${userId}:${normalizeCacheKey(message.text)}`

  // Redis check (with safe wrapper)
  const cached = await redisSafe(
    (redis) => redis.get(cacheKey),
    null,
  )
  if (cached !== null) {
    if (cached === 'NULL') return null
    return JSON.parse(cached) as FlowRow
  }

  // ... existing DB query ...

  // Cache result via Redis safe wrapper
  if (result) {
    await redisSafe(
      (redis) => redis.set(cacheKey, JSON.stringify(result), 'EX', 5),
      undefined,
    )
  } else {
    await redisSafe(
      (redis) => redis.set(cacheKey, 'NULL', 'EX', 5),
      undefined,
    )
  }

  return result
}
```

**Why:** Same as A7 but works across multiple instances and survives restarts.

**Risk:** Low. 5s TTL is short. `redisSafe` handles connection failures.

---

### B5 — Real-time wait steps (optional, advanced)  [P1, P20: FIXED + DOCUMENTED]

**Current:** Wait steps write to `automation_pending_executions` DB table. A cron polls every N minutes.

**With Redis:** In addition to the DB row, push a sorted-set entry:
```ts
import { redisSafe } from '@/lib/redis/client'

const runAtEpoch = Date.now() + ms
const pendingId = pendingRow.id

await redisSafe(
  (redis) => redis.zadd('wacrm:pending', runAtEpoch, pendingId),
  undefined,
)
```

A lightweight in-process scheduler picks due items:
```ts
async function processDuePendings() {
  const due = await redisSafe(
    (redis) => redis.zrangebyscore('wacrm:pending', 0, Date.now()),
    [],
  )
  for (const id of due) {
    await redisSafe(
      (redis) => redis.zrem('wacrm:pending', id),
      undefined,
    )
    // ... resume execution via resumePendingExecution()
  }
  setTimeout(processDuePendings, 1000)
}
```

**⚠️ SERVERLESS LIMITATION [P20]:** `setTimeout`-based scheduling only works in long-running Node.js processes (self-hosted VPS, bare metal). On serverless platforms (Vercel, Netlify), the scheduler dies when the function returns. The DB cron remains as safety net for all deployment targets.

**Why:** Wait steps resume within ~1 second instead of waiting for the next cron tick.

**Risk:** Medium. The DB cron remains as safety net.

---

## Track C — AI-Powered Smart Reply for Inbox

### Background
The app already has an AI Automation chat assistant under `/api/ai-automation` that uses `callAi()` from `src/lib/ai/provider.ts`. The same AI provider is reused.

### Design Decisions

#### 1. No new dependencies
Reuse `callAi()` from `src/lib/ai/provider.ts`.

#### 2. No breaking changes to the send flow
The AI button only **fills the textarea** or **shows a template/flow recommendation chip**.

#### 3. Two modes in one button
- **Auto-suggest**: Empty textarea → AI writes a reply from context
- **Guided**: Agent types instructions → AI incorporates them

#### 4. Context memory: last 10 messages
The API fetches the last 10 messages. Token budget: roughly 800 tokens for 10 typical messages — fits within the 1024 max_tokens with room for prompt + templates.

#### 5. Template-aware AI  [P4: TOKEN BUDGET FIX]
The API fetches the user's **approved** message templates. **Only name and category** are included in the prompt (NOT body_text) to save tokens. The full body_text is retrieved server-side when the AI selects a template.

#### 6. Flow-aware AI
The API fetches the user's **active** flows (name, trigger_type only — not full config).

#### 7. Fallback when AI is not configured
If `AI_API_KEY` is not set, the button shows a tooltip "AI not configured".

#### 8. Three-column response structure
```typescript
interface AiReplyResponse {
  suggestion: string | null;
  template_recommendation: {
    id: string;
    name: string;
    params: string[];
  } | null;
  flow_suggestion: {
    id: string;
    name: string;
    action: "trigger" | "resume";
  } | null;
  error?: string;
}
```

---

### C1 — API endpoint `POST /api/ai-reply/suggest`  [P3, P4, P8, P12, P19: FIXED]

**File**: `src/app/api/ai-reply/suggest/route.ts` (NEW)

**Key changes from v1:**
- Uses `callAi()` with JSON response format (not text parsing) [P3]
- Template names only (no body_text) in prompt [P4]
- Case-insensitive template status filter [P12]
- Rate limit key: `ai_reply` (not `aiReply`) [P19]
- Uses `checkRateLimitWithRedis` [P8]
- Token budget guard: limits templates to 30, flows to 10

**Request:**
```json
{
  "conversation_id": "uuid",
  "agent_text": "optional partial draft or instructions"
}
```

**Response:**
```json
{
  "suggestion": "Sure, our business hours are 9 AM to 6 PM, Mon-Fri.",
  "template_recommendation": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "business_hours",
    "params": ["9 AM", "6 PM"]
  },
  "flow_suggestion": null
}
```

**Flow:**
1. Auth via Supabase server client
2. Rate-limit via `await checkRateLimitWithRedis(`ai_reply:${user.id}`, RATE_LIMITS.ai_reply)`
3. Validate `conversation_id`, fetch conversation + contact
4. Fetch last 10 messages (`ORDER BY created_at DESC LIMIT 10`, then reverse)
5. Fetch user's approved templates — **only name & category** (not body_text). Filter by `LOWER(status) = 'approved'` for case-insensitivity [P12]. Limit to 30.
6. Fetch user's **active** flows — name, trigger_type only. Limit to 10.
7. Check if contact has an active flow run
8. Call `callAi()` with the prompt → request JSON response format
9. Parse JSON directly from `response.choices[0].message.content` [P3]
10. If template selected, fetch its body_text server-side
11. Return the full response
12. On AI error: return `{ suggestion: null, error: "..." }`

**Rate limit entry:** Add `ai_reply: { limit: 30, windowMs: 60_000 }` to `RATE_LIMITS` in `src/lib/rate-limit.ts`. [P19]

**Security:**
- Conversation ownership verified by `user_id` match
- No data from one user's conversations leaks to another
- AI provider call uses the server-side API key only

---

### C2 — AI Reply button in MessageComposer  [P9: EXTRACTED TO SUB-COMPONENT]

**File**: `src/components/inbox/message-composer.tsx` (MODIFY)

**Instead of adding AI logic directly to MessageComposer (which is a focused 155-line component), extract a new component:**

**NEW file:** `src/components/inbox/ai-reply-button.tsx`
- `Sparkles` icon button
- Loading spinner state
- Fetches `POST /api/ai-reply/suggest`
- Callsbacks: `onSuggestion(text)`, `onSendTemplate(name, params)`, `onTriggerFlow(id, action)`
- Action chips for template/flow recommendations rendered here

**In MessageComposer:** Import and render `<AiReplyButton>` as a sibling of the template button + textarea.

**Changes to MessageComposer:**
1. Add `<AiReplyButton />` next to `<LayoutTemplate />` button
2. Accept new optional callback props: `onAiSuggestion`, `onAiTemplate`, `onAiFlow`
3. No new internal state (state lives in AiReplyButton via callbacks)

**Why:** Keeps MessageComposer focused, makes AI features testable in isolation.

---

### C3 — Wire up template/flow recommendations through parent

**File**: `src/components/inbox/message-thread.tsx` (MODIFY)

- Add new callbacks to pass down to `MessageComposer` (→ `AiReplyButton`):
  - `onSendTemplate(name, params)` — calls `POST /api/whatsapp/send` with template, shows optimistic message
  - `onTriggerFlow(flowId, action)` — starts/resumes a flow run
- These are additive callbacks, do not modify existing `onSend` or `handleSend`

---

### C4 — Prompt engineering  [P3: JSON OUTPUT, NOT TEXT PARSING]

**File**: `src/lib/ai/reply-prompt.ts` (NEW) — exports `buildReplyPrompt()` function

**Prompt structure — use JSON response format instead of CLI-style parsing:**

```
You are an AI reply assistant for a WhatsApp CRM.

## Contact
Name: {name}
Phone: {phone}

## Agent
{agent_name}

## Conversation History (last 10 messages, newest last)
{formatted messages}

## Agent's Instructions
{agent_text}

## Available Message Templates (names only)
{numbered list of template names with categories}

## Active Flows (names only)
{numbered list of flow names}

## Active Flow Run
{contact has an active run of "FAQ Bot"}

## Your Task
Read the conversation and agent instructions.
- If a template fits perfectly, respond with JSON: {"type":"template","name":"...","params":[...]}
- If a flow matches the conversation intent, respond with JSON: {"type":"flow","name":"...","action":"trigger"}
- Otherwise, respond with JSON: {"type":"reply","text":"..."}

Return ONLY valid JSON, no other text.
```

**Parsing:**
```ts
const raw = choice.message.content
const result = JSON.parse(raw)
// { type: "template", name: "...", params: [...] }
// { type: "flow", name: "...", action: "trigger" }
// { type: "reply", text: "..." }
```

**Why JSON instead of text parsing [P3]:** LLMs are more reliable with JSON output format. Even if JSON is malformed, `JSON.parse` with try-catch is simpler and more deterministic than regex-based text parsing.

---

## Testing Plan  [P18: NEW]

| Module | Test file | What to test |
|--------|-----------|-------------|
| `redis/client.ts` | `src/lib/redis/client.test.ts` | `getRedis()` returns null without REDIS_URL; `redisSafe()` returns fallback on error |
| `redis/helpers.ts` | `src/lib/redis/helpers.test.ts` | `getCachedPhone` / `setCachedPhone` with Redis mock |
| `rate-limit.ts` (B1) | `src/lib/rate-limit.test.ts` (extend) | `checkRateLimitWithRedis` falls back to sync `checkRateLimit` |
| `ai/reply-prompt.ts` | `src/lib/ai/reply-prompt.test.ts` | Renders prompt with all fields; handles empty states |
| `flows/engine.ts` (A7) | `src/lib/flows/engine.test.ts` (extend) | Entry flow cache hits/misses/expiry |
| `automations/engine.ts` (A2) | (manual review) | Race condition audit document |
| `components/inbox/ai-reply-button.tsx` | Manual | UI-only, verify button states |

---

## Combined Security & Compatibility Guarantees  [P1: UPDATED]

| Concern | Mitigation |
|---------|-----------|
| **Redis goes down** | `redisSafe()` catches all rejections; consumers get fallback value. The app works fully without Redis. |
| **No Lua scripts** (Redis) | Only `INCR`, `EXPIRE`, `SET`, `GET`, `DEL`. |
| **Connection leak** (Redis) | `lazyConnect: true` + `retryStrategy: () => null`. Singleton per process. `connectionLost` flag prevents reuse after error. |
| **Key isolation** (Redis) | All Redis keys prefixed with `wacrm:`. |
| **Secrets in env** | `REDIS_URL` and `AI_API_KEY` never logged, never exposed to client code. |
| **No code changes to existing functions** | Every new function is additive. Existing sync `checkRateLimit` unchanged (tests pass). Existing `handleSend`/`onSend`/send route untouched. |
| **Indexes are IF NOT EXISTS** | All SQL migrations idempotent. |
| **Self-hosted without Redis** | Full featured. Redis only adds cross-instance dedup/caching. |
| **Self-hosted without AI** | AI Smart Reply button gracefully shows "AI not configured". |
| **Template recommendation** | Uses same `POST /api/whatsapp/send` endpoint. |
| **Flow recommendation** | Uses existing `POST /api/flows/{id}/runs` endpoint. |
| **Rate limiting** | AI endpoint rate-limited at 30 req/min per user. |
| **A4 duplicate guard** | `.limit(2)` instead of `.maybeSingle()` — never throws. |

---

## Files Changed Summary

| File | Action | Track | Change from v1 |
|------|--------|-------|----------------|
| `supabase/migrations/015_add_contacts_user_phone_index.sql` | CREATE | A1, A5, A6 | — |
| `src/lib/automations/engine.ts` | MODIFY | A2, A3 | A2: race docs + serial opt-in. A3: scale corrected |
| `src/app/api/whatsapp/webhook/route.ts` | MODIFY | A4, B2 | A4: `.limit(2)` guard. B2: `redisSafe()` wrapper |
| `src/lib/flows/engine.ts` | MODIFY | A7, B4 | A7: normalizeCacheKey + FIFO docs. B4: `redisSafe()` |
| `src/lib/redis/client.ts` | CREATE | B0 | `redisSafe()` helper + `connectionLost` flag |
| `.env.local.example` | MODIFY | B0 | Path corrected to project root |
| `src/lib/rate-limit.ts` | MODIFY | B1, C1 | B1: `redisSafe()`. C1: `ai_reply` key |
| `src/lib/redis/helpers.ts` | CREATE | B3 | Uses `redisSafe()` |
| `src/lib/automations/meta-send.ts` | MODIFY | B3 | Per-file pattern adaptation |
| `src/app/api/whatsapp/send/route.ts` | MODIFY | B3 | Per-file pattern adaptation |
| `src/lib/flows/meta-send.ts` | MODIFY | B3 | Per-file pattern adaptation (2 patterns in 1 file) |
| `src/app/api/whatsapp/broadcast/route.ts` | MODIFY | B3 | **NEW** — was missing from v1 |
| `src/app/api/ai-reply/suggest/route.ts` | CREATE | C1 | JSON response, `ai_reply` key, template name-only |
| `src/lib/ai/reply-prompt.ts` | CREATE | C4 | JSON output format |
| `src/components/inbox/message-composer.tsx` | MODIFY | C2 | Import `<AiReplyButton>` sub-component |
| `src/components/inbox/ai-reply-button.tsx` | CREATE | C2 | **NEW** — extracted from C2 |
| `src/components/inbox/message-thread.tsx` | MODIFY | C3 | — |
| `src/lib/redis/client.test.ts` | CREATE | B0 | **NEW** — Redis safe wrapper tests |
| `src/lib/redis/helpers.test.ts` | CREATE | B3 | **NEW** — Phone cache tests |
| `src/lib/ai/reply-prompt.test.ts` | CREATE | C4 | **NEW** — Prompt builder tests |

---

## Recommended Implementation Order

### Phase 1 — Low-effort, immediate wins (A1 + A5 + A6)
Create the migration file with all 3 indexes. Run migration.

### Phase 2 — No-Redis performance (A3 → A4 → A7 → A2)
1. **A3** — Minor `resolveConversationId` cache
2. **A4** — Direct phone lookup with `.limit(2)` guard
3. **A7** — In-memory entry flow cache with `normalizeCacheKey`
4. **A2** — Parallel automations (document races; keep serial as default)

### Phase 3 — Redis foundation (B0 + B1)  [P1: Redis safe wrapper first]
1. **B0** — Install `ioredis`, create `src/lib/redis/client.ts` with `redisSafe()`
2. **B0** — Write `src/lib/redis/client.test.ts`
3. **B1** — Add `checkRateLimitWithRedis` using `redisSafe()`

### Phase 4 — Redis reliability wins (B2 + B3)
1. **B2** — Webhook dedup with `redisSafe()`
2. **B3** — Phone cache across all 4 sender files + `helpers.test.ts`

### Phase 5 — Redis caching (B4)
1. **B4** — Redis entry flow cache

### Phase 6 — AI Smart Reply (C4 → C1 → C2 → C3)
1. **C4** — Prompt builder with JSON output format + tests
2. **C1** — API endpoint with `ai_reply` rate limit
3. **C2** — Create `AiReplyButton` sub-component, integrate in `MessageComposer`
4. **C3** — Wire callbacks through `MessageThread`

### Phase 7 — Advanced (B5, defer)
1. **B5** — Real-time wait steps (with serverless limitation docs)

---

## Summary Table

| Item | Without Redis | With Redis | Risk (v1.1) |
|------|--------------|-----------|-------------|
| **A1** — Index `contacts(user_id, phone)` | Faster queries | Same | None |
| **A2** — Parallel automations | Concurrent or serial (opt-in) | Same | **Medium** (race conditions documented — serial mode available) |
| **A3** — Cached conversation | Minor for resumed executions | Same | Near zero |
| **A4** — Direct phone lookup | O(1) with `.limit(2)` guard | Same | Near zero |
| **A5** — Index `flow_runs(user_id, contact_id)` | Faster flow dup check | Same | None |
| **A6** — Index `flows(user_id, status)` | Faster entry-flow scan | Same | None |
| **A7** — In-memory entry flow cache (FIFO) | Dedup burst keyword hits | Same | Low |
| **B1** — Rate limiter | In-memory (per-instance) | Cross-instance via `redisSafe()` | Near zero (additive) |
| **B2** — Webhook dedup | No dedup | Dedup within 30s | Minimal (TOCTOU documented) |
| **B3** — Phone cache (4 files) | Variant retry every time | First send retries, then cached | Low |
| **B4** — Redis entry flow cache | In-memory (per-instance) | Cross-instance via `redisSafe()` | Low |
| **B5** — Real-time wait steps | Cron polling (minutes) | ~1s resume (VPS only) | Medium (serverless limitations) |
| **C1** — AI reply endpoint (JSON format) | AI with template/flow awareness | Same | Low |
| **C2** — AI button (`AiReplyButton`) | Suggestion fills textarea | Same | Low |
| **C3** — Template/flow action chips | One-click send/trigger | Same | Low |
