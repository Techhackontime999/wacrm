# Final Plan — Performance, Redis & AI Smart Reply

## Overview

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

### A2 — Parallelize automations

**File:** `src/lib/automations/engine.ts` — change `runAutomationsForTrigger`

**Before (sequential):**
```ts
for (const automation of automations as Automation[]) {
  if (!triggerMatches(automation, input.context)) continue
  try { await executeAutomation(automation, input) } catch (err) { ... }
}
```

**After (parallel):**
```ts
const results = await Promise.allSettled(
  automations.map(async (automation) => {
    if (!triggerMatches(automation, input.context)) return
    await executeAutomation(automation, input)
  })
)
```

**Why:** Multiple automations triggered by the same event (e.g., `new_message_received`) run concurrently instead of waiting for each other.

**Risk:** Low. `Promise.allSettled` ensures one failure never affects others. **Trade-off:** execution order between automations is no longer guaranteed — acceptable because automations are independent.

---

### A3 — Cache `resolveConversationId`

**File:** `src/lib/automations/engine.ts` — modify `resolveConversationId`

**Before:** Every `send_message`/`send_template` step queries Supabase to find the conversation by `user_id + contact_id`.

**After:**
```ts
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  if (args.context.conversation_id) return args.context.conversation_id
  // ...existing DB lookup, then store result back:
  args.context.conversation_id = data.id
  return data.id
}
```

**Why:** Only the first send step per automation run does a DB query.

**Risk:** Near zero. The `conversation_id` is immutable for a given contact+user pair during a single automation run.

---

### A4 — Direct phone lookup in webhook

**File:** `src/app/api/whatsapp/webhook/route.ts` — modify `findOrCreateContact`

**Before:**
```ts
const { data: contacts } = await supabaseAdmin()
  .from('contacts').select('*').eq('user_id', userId)
const existing = contacts?.find((c) => phonesMatch(c.phone, phone))
```

**After:**
```ts
// Exact match first (fast with the new index)
const { data: exact } = await supabaseAdmin()
  .from('contacts').select('*')
  .eq('user_id', userId).eq('phone', phone).maybeSingle()
if (exact) return { contact: exact, wasCreated: false }

// Fuzzy fallback (preserves existing behavior for mismatched formats)
const { data: contacts } = await supabaseAdmin()
  .from('contacts').select('*').eq('user_id', userId)
const existing = contacts?.find((c) => phonesMatch(c.phone, phone))
```

**Why:** For contacts with an exact phone match (most common case), this is O(1) instead of O(n).

**Risk:** Very low. Fuzzy fallback is untouched.

---

### A5 — Index `flow_runs(user_id, contact_id)` for duplicate inbound check

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_contact
  ON flow_runs (user_id, contact_id);
```

**Why:** `isDuplicateInbound()` in `src/lib/flows/engine.ts` runs for every inbound message when a flow is active. The index makes the query an index-only scan instead of a sequential scan.

**Also speeds up:** `loadActiveRunForContact()` — same query pattern.

**Risk:** Zero. `IF NOT EXISTS` is idempotent.

---

### A6 — Index `flows(user_id, status)` for fast entry-flow scan

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flows_user_status
  ON flows (user_id, status);
```

**Why:** `findEntryFlow()` in `src/lib/flows/engine.ts` fetches all active flows for the user on every inbound message. Without an index, this does a sequential scan.

**Risk:** Zero. `IF NOT EXISTS` is idempotent.

---

### A7 — Cache `findEntryFlow` result (in-memory)

**File:** `src/lib/flows/engine.ts` — add in-memory cache

```ts
const entryFlowCache = new Map<string, { flow: FlowRow | null; expiresAt: number }>()
const ENTRY_CACHE_TTL_MS = 5_000 // 5 seconds
const ENTRY_CACHE_MAX = 100 // prevent unbounded memory growth

async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger
  if (message.kind !== 'text') return null

  const cacheKey = `${userId}:${message.text.toLowerCase()}`
  const cached = entryFlowCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.flow

  // ... existing DB query ...

  // Evict oldest entry if at capacity (poor man's LRU)
  if (entryFlowCache.size >= ENTRY_CACHE_MAX) {
    const oldest = entryFlowCache.keys().next().value
    if (oldest !== undefined) entryFlowCache.delete(oldest)
  }
  entryFlowCache.set(cacheKey, { flow: result, expiresAt: Date.now() + ENTRY_CACHE_TTL_MS })
  return result
}
```

**Why:** If a customer sends the same keyword multiple times within seconds, the second hit skips the DB query entirely. 5s TTL is long enough for burst dedup, short enough to not delay a real keyword change.

**With Redis:** Same pattern using `redis.set(key, flowJson, 'EX', 5)` — survives restarts and scales across instances (see B4 below).

**Risk:** Low. Cache bounded at 100 entries with poor-man's LRU eviction.

---

## Track B — Redis Integration (optional, opt-in)

### B0 — Dependency & Connection

**Install:**
```
npm install ioredis@^5.6
```

**File:** `src/lib/redis/client.ts`
```ts
import Redis from 'ioredis'

let client: Redis | null = null

export function getRedis(): Redis | null {
  if (client !== null) return client
  const url = process.env.REDIS_URL
  if (!url) return null
  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  })
  client.on('error', (err) => console.warn('[redis]', err.message))
  return client
}

export function isRedisAvailable(): boolean {
  return getRedis() !== null
}
```

**Graceful degradation:** `getRedis()` returns null when `REDIS_URL` is unset, Redis is down, or connection fails. Every consumer checks for null and falls back to existing behavior.

**Security:**
- Password is embedded in `REDIS_URL` — never logged
- All keys prefixed with `wacrm:` for namespace isolation
- Only basic commands: `INCR`, `EXPIRE`, `SET`, `GET`, `DEL` — no Lua scripts
- On error: warns once, returns null, never blocks the caller

**File:** `.env.local.example` — add
```
# Redis — optional. Makes rate limiting, webhook dedup, and phone
# variant caching work across instances. Without it, all features
# fall back to in-memory / DB defaults.
# REDIS_URL=redis://default:password@localhost:6379
```

---

### B1 — Redis-backed rate limiter (optional wrapper)

**Critical constraint:** `checkRateLimit` is tested synchronously in `src/lib/rate-limit.test.ts` (calls without `await`). Making it async would break all existing tests. Therefore:

- **Keep `checkRateLimit` synchronous** — unchanged signature, always uses in-memory Map. No test changes.
- **Add a new async function** `checkRateLimitWithRedis(key, options)` — same return shape, uses Redis when available, falls back to in-memory.

**File:** `src/lib/rate-limit.ts` — add alongside existing code

```ts
export async function checkRateLimitWithRedis(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) return checkRateLimit(key, { limit, windowMs })

  const now = Date.now()
  const redisKey = `wacrm:rl:${key}`
  const count = await redis.incr(redisKey)
  if (count === 1) await redis.expire(redisKey, Math.ceil(windowMs / 1000))

  if (count > limit) {
    const ttl = await redis.ttl(redisKey)
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

### B2 — Webhook deduplication

**File:** `src/app/api/whatsapp/webhook/route.ts` — insert before `processWebhook()`

```ts
const redis = getRedis()
if (redis && body.entry) {
  const msgIds: string[] = []
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      for (const msg of change.value.messages ?? []) {
        msgIds.push(msg.id)
      }
    }
  }
  for (const id of msgIds) {
    const key = `wacrm:webhook:${id}`
    const ok = await redis.set(key, '1', 'EX', 30, 'NX')
    if (!ok) {
      console.log('[webhook] duplicate', id, 'skipped')
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
  }
}
```

**Why:** Meta can deliver the same webhook payload twice within seconds. 30s TTL is generous for dedup without blocking legitimate re-delivery.

**Risk:** Minimal. When Redis is off, the block is skipped entirely.

---

### B3 — Phone variant cache

**Problem:** Every `send_message`/`send_template` step tries up to 3 phone variants against Meta's API. This repeats on **every** send to the same contact.

**Files to modify (same pattern in each):**
- `src/lib/automations/meta-send.ts` (automation sends)
- `src/app/api/whatsapp/send/route.ts` (manual agent sends)
- `src/lib/flows/meta-send.ts` (flow engine sends)

**File:** `src/lib/redis/helpers.ts`

```ts
const PHONE_CACHE_TTL = 86_400 // 24 hours

export async function getCachedPhone(contactId: string): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null
  return redis.get(`wacrm:phone:${contactId}`)
}

export async function setCachedPhone(contactId: string, phone: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(`wacrm:phone:${contactId}`, phone, 'EX', PHONE_CACHE_TTL)
}

export async function invalidateCachedPhone(contactId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(`wacrm:phone:${contactId}`)
}
```

**Usage in each sender:**
```ts
const cachedPhone = await getCachedPhone(contact.id)
const variants = cachedPhone
  ? [cachedPhone, ...phoneVariants(sanitized).filter(v => v !== cachedPhone)]
  : phoneVariants(sanitized)

// After successful send:
if (workingPhone !== sanitized || !cachedPhone) {
  await setCachedPhone(contact.id, workingPhone)
}
```

**Why:** After the first successful send to a contact, subsequent sends skip the 3-variant retry loop entirely. This is the single biggest latency win for automation flows that send multiple messages to the same contact.

**Invalidation:** When a contact's phone is edited in the CRM, call `invalidateCachedPhone(contactId)`. Add this to the contact update flow (optional, low priority).

**Risk:** Low. Cached phone is tried first, but if it fails, the full variant loop runs as fallback. Cache is self-healing.

---

### B4 — Redis-backed entry flow cache

**File:** `src/lib/flows/engine.ts` — extend `findEntryFlow`

Replace the in-memory cache from A7 with Redis when available:

```ts
async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  if (message.kind !== 'text') return null

  const redis = getRedis()
  const cacheKey = `wacrm:flow:entry:${userId}:${message.text.toLowerCase()}`

  // Redis check
  if (redis) {
    const cached = await redis.get(cacheKey)
    if (cached === 'NULL') return null
    if (cached) return JSON.parse(cached) as FlowRow
  }

  // ... existing DB query ...

  // Cache result
  if (redis) {
    if (result) {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 5)
    } else {
      await redis.set(cacheKey, 'NULL', 'EX', 5)
    }
  }

  return result
}
```

**Why:** Same as A7 but works across multiple instances. Also caches "no match" results.

**Risk:** Low. 5s TTL is short.

---

### B5 — Real-time wait steps (optional, advanced)

**Current:** Wait steps write to `automation_pending_executions` DB table. A cron polls every N minutes to resume them.

**With Redis:** In addition to the DB row, push a sorted-set entry:
```ts
const redis = getRedis()
if (redis) {
  await redis.zadd('wacrm:pending', runAtEpoch, pendingId)
}
```

A lightweight in-process scheduler picks due items:
```ts
async function processDuePendings() {
  const redis = getRedis()
  if (!redis) return
  const now = Date.now()
  const due = await redis.zrangebyscore('wacrm:pending', 0, now)
  for (const id of due) {
    await redis.zrem('wacrm:pending', id)
    // ... resume execution
  }
  setTimeout(processDuePendings, 1000)
}
```

**Why:** Wait steps resume within ~1 second instead of waiting for the next cron tick.

**Risk:** Medium — most invasive change. The DB cron remains as safety net.

---

## Track C — AI-Powered Smart Reply for Inbox

### Background
The app already has an AI Automation chat assistant under `/api/ai-automation` that uses `callAi()` from `src/lib/ai/provider.ts`. The same AI provider is reused for helping agents write replies faster in the inbox.

Existing tables the AI will query:
- `message_templates` — approved WhatsApp message templates (name, body_text, category, language)
- `flows` — active flows with their trigger types and names
- `flow_runs` — to check if this contact currently has an active flow run

### Design Decisions

#### 1. No new dependencies
Reuse `callAi()` from `src/lib/ai/provider.ts` — same OpenAI-compatible API, same env vars.

#### 2. No breaking changes to the send flow
The AI button only **fills the textarea** or **shows a template/flow recommendation chip**. The agent still clicks Send or the chip as before. Zero changes to existing `handleSend`, `onSend`, or the send API route.

#### 3. Two modes in one button
- **Auto-suggest**: Agent clicks AI button with an empty textarea → AI writes a reply from conversation context + available templates/flows.
- **Guided**: Agent types partial instructions (e.g. "offer 20% off, sound urgent") then clicks AI → AI incorporates those instructions into the reply.

#### 4. Context memory: last 10 messages
The API fetches the last 10 messages in the conversation and includes them in the prompt for coherent replies without blowing the token budget.

#### 5. Template-aware AI
The API fetches the user's **approved** message templates (name, body_text, category) and includes them in the system prompt. The AI can:
- Select a matching template and recommend it with filled parameters
- Fall back to a free-text reply when no template fits
- Return `template_recommendation` in the response when it finds a match

#### 6. Flow-aware AI
The API fetches the user's **active** flows (name, trigger_type) and checks if this contact has an **active flow run**. The AI can:
- Suggest triggering a flow if the contact's intent matches
- Suggest resuming a paused flow run
- Return `flow_suggestion` in the response

#### 7. Fallback when AI is not configured
If `AI_API_KEY` is not set, the button shows a tooltip "AI not configured". No crash, no error.

#### 8. Three-column response structure
```typescript
interface AiReplyResponse {
  suggestion: string | null;                     // free-text reply suggestion
  template_recommendation: {                     // optional template match
    id: string;
    name: string;
    params: string[];                            // filled parameter values
  } | null;
  flow_suggestion: {                             // optional flow match
    id: string;
    name: string;
    action: "trigger" | "resume";                // start new or resume existing
  } | null;
  error?: string;
}
```

---

### C1 — API endpoint `POST /api/ai-reply/suggest`   (risk: low)

**File**: `src/app/api/ai-reply/suggest/route.ts` (NEW)

**Request**:
```json
{
  "conversation_id": "uuid",
  "agent_text": "optional text from the textarea" // guided mode
}
```

**Response**:
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

**Flow**:
1. Auth via Supabase server client (same as other API routes)
2. Rate-limit per user (30 req/min — generous for human-paced use)
3. Validate `conversation_id`, fetch conversation + contact
4. Fetch last 10 messages (`ORDER BY created_at DESC LIMIT 10`, then reverse)
5. Fetch user's **approved** message templates (`status = 'Approved'`) — name, body_text, category
6. Fetch user's **active** flows (`status = 'active'`) — name, trigger_type
7. Check if contact has an **active flow run** (`flow_runs` WHERE `contact_id` AND `status = 'active'`)
8. Build system prompt with: contact info, agent name, conversation history, agent instructions, available templates, active flows, active flow run indicator
9. Call `callAi()` with the prompt
10. Parse the AI's structured response (`TEMPLATE:` / `FLOW:` / `REPLY:`)
11. Return the full response
12. On AI error: return `{ suggestion: null, error: "..." }` — the frontend shows a toast

**Rate limit entry**: Add `aiReply: { limit: 30, windowMs: 60_000 }` to `RATE_LIMITS` in `src/lib/rate-limit.ts`.

**Security**:
- Conversation ownership verified by `user_id` match
- No data from one user's conversations leaks to another
- AI provider call uses the server-side API key only

---

### C2 — AI Reply button in MessageComposer   (risk: low)

**File**: `src/components/inbox/message-composer.tsx` (MODIFY)

**Changes**:
1. Add a `Sparkles` icon button (the "AI" button) next to the template button, before the textarea
2. Add state for AI loading and AI suggestion data (suggestion text, template recommendation, flow suggestion)
3. On click:
   - If already loading, ignore
   - Read current `text` from state → this becomes `agent_text`
   - Set `aiLoading = true`
   - Fetch `POST /api/ai-reply/suggest` with `{ conversation_id, agent_text }`
   - On success:
     - If `suggestion` is present: `setText(suggestion)` — fills the textarea
     - If `template_recommendation` is present: show a "Send as [name]" action chip below the textarea
     - If `flow_suggestion` is present: show a "Start [flow]" / "Resume [flow]" action chip
   - On error: `toast.error("AI reply failed: ...")`
   - Set `aiLoading = false`
4. The AI button shows a spinner while loading, disabled when `sessionExpired` or `conversationId` is empty

**No changes to `onSend` or existing button behavior.**

Action chips handle their own distinct flows:
- **Template chip** → directly calls `POST /api/whatsapp/send` with `{ message_type: "template", template_name, template_params }` + shows optimistic message
- **Flow chip** → calls `POST /api/flows/{id}/runs` to start or `PATCH` to resume

---

### C3 — Wire up template/flow recommendations through parent   (risk: low)

**File**: `src/components/inbox/message-thread.tsx` (MODIFY)

- Add new callbacks to pass down to `MessageComposer`:
  - `onSendTemplate(name, params)` — calls `POST /api/whatsapp/send` with template, shows optimistic message
  - `onTriggerFlow(flowId, action)` — starts/resumes a flow run
- These are additive callbacks, do not modify existing `onSend` or `handleSend`

---

### C4 — Prompt engineering (key to quality)

**File**: `src/lib/ai/reply-prompt.ts` (NEW) — exports `buildReplyPrompt()` function

Prompt structure:
```
You are an AI reply assistant for a WhatsApp CRM.

## Contact
Name: {name}
Phone: {phone}
Company: {company}

## Agent
{agent_name}

## Conversation History (last 10 messages, newest last)
{formatted messages}

## Agent's Instructions
{agent_text}

## Available Message Templates
{numbered list with name and body_text}

## Active Flows
{numbered list of flows}

## Active Flow Run
{contact has an active run of "FAQ Bot"}

## Your Task
- Read the conversation and agent instructions.
- Pick a template if one fits perfectly, otherwise write a natural reply.
- Suggest a flow if the conversation fits its trigger.
- Return exactly one of:
  TEMPLATE: template_name | param1 | param2
  FLOW: flow_name | trigger | resume
  REPLY: your suggestion text
```

Parsing:
- `TEMPLATE: name | p1 | p2` → `template_recommendation`
- `FLOW: name | trigger` → `flow_suggestion`
- `REPLY: text` → `suggestion`

---

## Combined Security & Compatibility Guarantees

| Concern | Mitigation |
|---------|-----------|
| **Redis goes down** | Every `getRedis()` returns null; all consumers fall back to existing behavior (in-memory or DB). The app works fully without Redis. |
| **No Lua scripts** (Redis) | Only `INCR`, `EXPIRE`, `SET`, `GET`, `DEL`. |
| **Connection leak** (Redis) | `lazyConnect: true` + `retryStrategy: () => null`. Singleton per process. |
| **Key isolation** (Redis) | All Redis keys prefixed with `wacrm:`. |
| **Secrets in env** | `REDIS_URL` and `AI_API_KEY` never logged, never exposed to client code. |
| **No code changes to existing functions** | Every new function is additive. Existing sync `checkRateLimit` unchanged (tests pass). Existing `handleSend`/`onSend`/send route untouched. |
| **Indexes are IF NOT EXISTS** | All SQL migrations idempotent. |
| **Self-hosted without Redis** | Full featured. Redis only adds cross-instance dedup/caching. |
| **Self-hosted without AI** | AI Smart Reply button gracefully shows "AI not configured". No errors. |
| **Template recommendation** | Uses same `POST /api/whatsapp/send` endpoint with same validation. |
| **Flow recommendation** | Uses existing `POST /api/flows/{id}/runs` endpoint. |
| **Rate limiting** | AI endpoint rate-limited at 30 req/min per user. |

---

## Files Changed Summary

| File | Action | Track |
|------|--------|-------|
| `supabase/migrations/015_add_contacts_user_phone_index.sql` | CREATE | A1, A5, A6 |
| `src/lib/automations/engine.ts` | MODIFY | A2, A3 |
| `src/app/api/whatsapp/webhook/route.ts` | MODIFY | A4, B2 |
| `src/lib/flows/engine.ts` | MODIFY | A7, B4 |
| `src/lib/redis/client.ts` | CREATE | B0 |
| `src/.env.local.example` | MODIFY | B0 |
| `src/lib/rate-limit.ts` | MODIFY | B1, C1 |
| `src/lib/redis/helpers.ts` | CREATE | B3 |
| `src/lib/automations/meta-send.ts` | MODIFY | B3 |
| `src/app/api/whatsapp/send/route.ts` | MODIFY | B3 |
| `src/lib/flows/meta-send.ts` | MODIFY | B3 |
| `src/app/api/ai-reply/suggest/route.ts` | CREATE | C1 |
| `src/lib/ai/reply-prompt.ts` | CREATE | C4 |
| `src/components/inbox/message-composer.tsx` | MODIFY | C2 |
| `src/components/inbox/message-thread.tsx` | MODIFY | C3 |

---

## Recommended Implementation Order

### Phase 1 — Low-effort, immediate wins (A1 + A5 + A6)
Create the migration file with all 3 indexes (zero-code, idempotent). Run migration.

### Phase 2 — No-Redis performance (A3 → A4 → A7 → A2)
1. **A3** — Cache `resolveConversationId` (one-method change)
2. **A4** — Direct phone lookup in webhook (first-exact-then-fuzzy)
3. **A7** — In-memory entry flow cache (add Map + TTL check)
4. **A2** — Parallel automations (`for` → `Promise.allSettled`)

### Phase 3 — Redis foundation (B0 + B1)
1. **B0** — Install `ioredis`, create `src/lib/redis/client.ts`
2. **B1** — Add `checkRateLimitWithRedis` (additive, opt-in at call sites)

### Phase 4 — Redis reliability wins (B2 + B3)
1. **B2** — Webhook dedup (insert before `processWebhook`)
2. **B3** — Phone variant cache across all 3 senders (auto + agent + flow)

### Phase 5 — Redis caching (B4)
1. **B4** — Redis entry flow cache (upgrade A7 when Redis available)

### Phase 6 — AI Smart Reply (C1 → C4 → C2 → C3)
1. **C1** — API endpoint
2. **C4** — Prompt builder utility
3. **C2** — MessageComposer AI button + chips
4. **C3** — Wire template/flow action callbacks through MessageThread

### Phase 7 — Advanced (B5, defer)
1. **B5** — Real-time wait steps (sorted set + in-process scheduler)

---

## Summary Table

| Item | Without Redis | With Redis | Risk |
|------|--------------|-----------|------|
| **A1** — Index `contacts(user_id, phone)` | Faster queries | Same | None |
| **A2** — Parallel automations | Concurrent execution | Same | Low (order) |
| **A3** — Cached conversation | No repeat DB queries | Same | Near zero |
| **A4** — Direct phone lookup | O(1) for exact match | Same | Very low |
| **A5** — Index `flow_runs(user_id, contact_id)` | Faster flow dup check | Same | None |
| **A6** — Index `flows(user_id, status)` | Faster entry-flow scan | Same | None |
| **A7** — In-memory entry flow cache | Dedup burst keyword hits | Same | Low |
| **B1** — Rate limiter | In-memory (per-instance) | Cross-instance via async wrapper | Zero (additive) |
| **B2** — Webhook dedup | No dedup | Dedup within 30s window | Minimal |
| **B3** — Phone cache | Variant retry every time | First send retries, then cached | Low |
| **B4** — Redis entry flow cache | In-memory (per-instance) | Cross-instance, survives restart | Low |
| **B5** — Real-time wait steps | Cron polling (minutes) | ~1s resume | Medium (defer) |
| **C1** — AI reply endpoint | AI with template/flow awareness | Same (no Redis needed) | Low |
| **C2** — AI button in composer | Suggestion fills textarea | Same | Low |
| **C3** — Template/flow action chips | One-click send/trigger | Same | Low |
