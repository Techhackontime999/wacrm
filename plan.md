# Performance & Redis Integration Plan

## Overview

Two tracks — **Performance** (no Redis, works today) and **Redis** (optional, makes everything faster).  
Both are backward-compatible. Each change has a **fallback**: if Redis is off or unreachable, the app behaves exactly as it does now.

---

## Track A — Performance (Redis optional, works without it)

### Flow Engine Notes
The Flow engine (`src/lib/flows/engine.ts`) is called **synchronously** in the webhook (line 597 — `await dispatchInboundToFlows(...)`). Unlike automations which are fire-and-forget, **the Flow engine blocks the webhook response**. This means every optimization below that reduces send latency directly improves the webhook's response time to Meta.

B3 (phone cache) already covers `src/lib/flows/meta-send.ts` — see below.

---

### A1 — Index `contacts(user_id, phone)`

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone
  ON contacts (user_id, phone);
```

**Why:** Speeds up `findOrCreateContact` in the webhook, the contacts page search, and the phone lookup in `meta-send.ts`.

**Risk:** Zero. `IF NOT EXISTS` is idempotent. No queries change — the index just makes existing queries faster.

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

**Risk:** Low. Each automation has its own DB log row and its own `try/catch`. `Promise.allSettled` ensures one failure never affects others. **Trade-off:** execution order between automations is no longer guaranteed — acceptable because automations are independent.

**Fallback:** If you want sequential, keep the `for` loop — this change is optional.

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

**Why:** Only the first send step per automation run does a DB query. All subsequent send steps in the same automation use the cached value.

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

**Why:** For contacts with an exact phone match (most common case), this is O(1) instead of O(n). The old fuzzy path runs only when needed.

**Risk:** Very low. Exact match uses the same `phone` string that Meta sent — `normalizePhone(message.from)`. The fuzzy fallback is untouched.

---

### A5 — Index `flow_runs(user_id, contact_id)` for duplicate inbound check

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_contact
  ON flow_runs (user_id, contact_id);
```

**Why:** `isDuplicateInbound()` in `src/lib/flows/engine.ts:280-303` runs for every inbound message when a flow is active. It does:
```ts
const { data: runs } = await db
  .from('flow_runs')
  .select('id')
  .eq('user_id', userId)
  .eq('contact_id', contactId);
```
For contacts with hundreds of historical flow runs, this scans the whole table. The index makes it an index-only scan.

**Also speeds up:** `loadActiveRunForContact()` (line 182) — same query pattern with an additional `.eq('status', 'active')` filter.

**Risk:** Zero. `IF NOT EXISTS` is idempotent. No code changes needed.

---

### A6 — Index `flows(user_id, status)` for fast entry-flow scan

**File:** `supabase/migrations/015_add_contacts_user_phone_index.sql` (extend)

```sql
CREATE INDEX IF NOT EXISTS idx_flows_user_status
  ON flows (user_id, status);
```

**Why:** `findEntryFlow()` in `src/lib/flows/engine.ts:318-341` fetches all active flows for the user on every inbound message:
```ts
const { data: flows, error } = await db
  .from('flows')
  .select('*')
  .eq('user_id', userId)
  .eq('status', 'active')
  .order('created_at', { ascending: true });
```
Without an index, this does a sequential scan of the `flows` table. The index makes it an index-only scan regardless of how many inactive flows exist.

**Risk:** Zero. `IF NOT EXISTS` is idempotent. No code changes.

---

### A7 — Cache `findEntryFlow` result (no Redis version)

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

**Why:** If a customer sends the same keyword multiple times within seconds (taps "Menu" twice), the second hit skips the DB query entirely. 5s TTL is long enough for burst dedup, short enough to not delay a real keyword change.

**With Redis:** Same pattern using `redis.set(key, flowJson, 'EX', 5)` — survives restarts and scales across instances (see B4 below).

**Risk:** Low. Cache is bounded at 100 entries with a poor-man's LRU eviction. TTL auto-evicts stale entries. No stale data risk because flow activation/deactivation is infrequent.

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
    retryStrategy: () => null, // don't reconnect on failure
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
// NEW — async version backed by Redis when available
export async function checkRateLimitWithRedis(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) return checkRateLimit(key, { limit, windowMs }) // sync fallback

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

**Why:** Existing sync `checkRateLimit` is per-instance (in-memory Map). The async `checkRateLimitWithRedis` uses Redis INCR + EXPIRE for atomic cross-instance counting. No sweep timer needed — Redis auto-expires keys.

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

**Risk:** Zero for existing code — `checkRateLimit` is untouched. The new `checkRateLimitWithRedis` is additive. `RATE_LIMITS` and `rateLimitResponse()` unchanged.

---

### B2 — Webhook deduplication

**File:** `src/app/api/whatsapp/webhook/route.ts` — insert before `processWebhook()`

```ts
// ── Deduplicate ────────────────────────────────────────────
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
// ── End dedup ──────────────────────────────────────────────
```

**Why:** Meta can deliver the same webhook payload twice within seconds. Without dedup, two automations fire, two messages get inserted, two inbox notifications appear.

**Risk:** Minimal. The 30s TTL is generous for dedup without blocking legitimate re-delivery. Redis `NX` ensures only the first request claims the ID. When Redis is off, the block is skipped entirely.

---

### B3 — Phone variant cache

**Problem:** Every `send_message`/`send_template` step tries up to 3 phone variants against Meta's API, waiting for each to fail with #131030 before trying the next. This repeats on **every** send to the same contact.

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

**Usage in each sender (example from `meta-send.ts`):**

```ts
// Before the variant loop:
const cachedPhone = await getCachedPhone(contact.id)
const variants = cachedPhone
  ? [cachedPhone, ...phoneVariants(sanitized).filter(v => v !== cachedPhone)]
  : phoneVariants(sanitized)

// After successful send:
if (workingPhone !== sanitized || !cachedPhone) {
  await setCachedPhone(contact.id, workingPhone)
}
```

**Why:** After the first successful send to a contact, subsequent sends skip the 3-variant retry loop entirely — they try the known working phone first. This is the single biggest latency win for automation flows that send multiple messages to the same contact.

**Invalidation:** When a contact's phone is edited in the CRM, call `invalidateCachedPhone(contactId)`. Add this to the contact update flow (optional, low priority).

**Risk:** Low. Cached phone is tried first, but if it fails (phone changed, number ported), the full variant loop runs as fallback. Cache is self-healing.

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
    const key = `wacrm:flow:entry:${userId}:${message.text.toLowerCase()}`
    if (result) {
      await redis.set(key, JSON.stringify(result), 'EX', 5)
    } else {
      await redis.set(key, 'NULL', 'EX', 5) // cache "no match" too
    }
  }

  return result
}
```

**Why:** Same as A7 but works across multiple instances. Also caches "no match" results to avoid re-scanning flows for common irrelevant keywords.

**Risk:** Low. 5s TTL is short. JSON parse/set is safe for the small flow config objects.

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

**Why:** Wait steps resume within ~1 second instead of waiting for the next cron tick (which could be minutes).

**Risk:** Medium — this is the most invasive change. The DB cron remains as a safety net; Redis just accelerates. Recommend deferring this phase.

---

## Summary

| Item | Without Redis | With Redis | Risk |
|---|---|---|---|
| **A1** — Index `contacts(user_id, phone)` | Faster queries | Same | None |
| **A2** — Parallel automations | Concurrent execution | Same | Low (order) |
| **A3** — Cached conversation | No repeat DB queries | Same | Near zero |
| **A4** — Direct phone lookup | O(1) for exact match | Same | Very low |
| **A5** — Index `flow_runs(user_id, contact_id)` | Faster flow duplicate check | Same | None |
| **A6** — Index `flows(user_id, status)` | Faster entry-flow scan | Same | None |
| **A7** — In-memory entry flow cache | Dedup burst keyword hits (5s) | Same | Low |
| **B1** — Rate limiter | In-memory (per-instance) | Cross-instance via `checkRateLimitWithRedis` (opt-in) | Zero (additive, no change to existing) |
| **B2** — Webhook dedup | No dedup | Dedup within 30s window | Minimal |
| **B3** — Phone cache (auto + flow + agent sends) | Variant retry every time | First send retries, then cached | Low (fallback loop) |
| **B4** — Redis entry flow cache | In-memory (per-instance) | Cross-instance, survives restart | Low |
| **B5** — Real-time wait steps | Cron polling (minutes) | ~1s resume | Medium (defer) |

## Security & Compatibility Guarantees

| Concern | Mitigation |
|---|---|
| **Redis goes down** | Every `getRedis()` returns null; all consumers fall back to existing behavior (in-memory or DB). The app works fully without Redis. |
| **No Lua scripts** | Only `INCR`, `EXPIRE`, `SET`, `GET`, `DEL` — reduces attack surface. No `EVAL`/`SCRIPT` commands. |
| **Connection leak** | `lazyConnect: true` + `retryStrategy: () => null` — never connects at import, never retries on failure. Singleton per process. |
| **Key isolation** | All Redis keys prefixed with `wacrm:` — no collisions with other apps on the same Redis instance. |
| **Secrets in env** | `REDIS_URL` contains the password inline. Never logged, never exposed to client code. |
| **No code changes to existing functions** | Every new function is additive. Existing sync `checkRateLimit` unchanged (tests pass). Existing `engine.ts` unchanged. Existing `meta-send.ts` unchanged. |
| **No new dependencies in critical path** | `ioredis` is only imported when `REDIS_URL` is set. Unused imports don't block the app. |
| **Indexes are IF NOT EXISTS** | All SQL migrations are idempotent — safe to run multiple times. |
| **Self-hosted without Redis** | Full featured. Redis only adds cross-instance dedup/caching. Zero Redis = zero changes. |

## Recommended implementation order

1. **A1 + A5 + A6** (indexes) — zero-code, immediate query speedup
2. **A3** (conversation cache) — trivial, no Redis
3. **A4** (phone lookup) + **A7** (flow cache) — big win for large contact lists
4. **A2** (parallel automations) — noticeable speedup for multi-automation setups
5. **B1** (rate limiter wrapper) — additive, opt-in at call sites
6. **B2** (webhook dedup) + **B3** (phone cache) — moderate effort, big reliability + speed win
7. **B4** (Redis flow cache) — only if running multiple instances
8. **B5** (real-time waits) — defer until everything else is stable
