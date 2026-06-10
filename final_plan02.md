# FINAL PLAN v2.0 — Performance, Redis & AI Smart Reply (Final)

## Overview

**This is a corrected version of `final_plan01.md` incorporating all fixes from `problem02.md` (R1–R11).** Every change is annotated with the problem ID (e.g., `[R1]`).

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

### A2 — Parallelize automations  [R9: FIXED — SERIAL IS DEFAULT, PARALLEL IS OPT-IN REORDERED]

**File:** `src/lib/automations/engine.ts` — change `runAutomationsForTrigger`

**The serial loop is the code that runs. Parallel is an opt-in alternative documented below.**

**Default (serial — unchanged):**
```ts
for (const automation of automations as Automation[]) {
  if (!triggerMatches(automation, input.context)) continue
  try { await executeAutomation(automation, input) } catch (err) { ... }
}
```

**Opt-in (parallel — only use when automations are independent):**
```ts
if (parallelMode) {
  const results = await Promise.allSettled(
    automations.map(async (automation) => {
      if (!triggerMatches(automation, input.context)) return
      await executeAutomation(automation, input)
    })
  )
}
```

**Why:** Multiple automations triggered by the same event run concurrently instead of waiting for each other. **Serial is the default.** Implementers add `parallelMode` only after auditing that no automations share write targets.

**⚠️ KNOWN RACE CONDITIONS (parallel mode only):**
| Race | Consequence |
|------|-------------|
| Two automations update the same contact field | Last write wins — intermediate value lost |
| Two automations add/remove tags on the same contact | Tag state depends on interleaving |
| Two automations create deals | Duplicate deals may appear |
| Two automations assign conversation | Last assignment wins |
| Log ordering (`automation_logs`) | Non-deterministic step order in logs |
| Execution counter RPC | Per-automation counter is atomic (safe), but `last_executed_at` may be set by whichever finishes last |

**Mitigation:** Keep the unmodified serial `for` loop. Only switch to `Promise.allSettled` when all automations for a given trigger are verified independent.

---

### A3 — Cache `resolveConversationId`  [No changes from v1.1]

**File:** `src/lib/automations/engine.ts` — modify `resolveConversationId`

```ts
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  if (args.context.conversation_id) return args.context.conversation_id
  // ...existing DB lookup, then store result back:
  args.context.conversation_id = data.id
  return data.id
}
```

**Impact:** Small — this is not a dramatic win.

---

### A4 — Direct phone lookup in webhook  [No changes from v1.1]

**File:** `src/app/api/whatsapp/webhook/route.ts` — modify `findOrCreateContact`

```ts
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

// Fuzzy fallback
const { data: contacts } = await supabaseAdmin()
  .from('contacts').select('*').eq('user_id', userId)
const existing = contacts?.find((c) => phonesMatch(c.phone, phone))
```

---

### A5 — Index `flow_runs(user_id, contact_id)`  [No changes from v1.1]

```sql
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_contact
  ON flow_runs (user_id, contact_id);
```

---

### A6 — Index `flows(user_id, status)`  [No changes from v1.1]

```sql
CREATE INDEX IF NOT EXISTS idx_flows_user_status
  ON flows (user_id, status);
```

---

### A7 — Cache `findEntryFlow` result (in-memory)  [R1: FIXED — isFirstInbound IN CACHE KEY]

**File:** `src/lib/flows/engine.ts` — add in-memory cache

```ts
const entryFlowCache = new Map<string, { flow: FlowRow | null; expiresAt: number }>()
const ENTRY_CACHE_TTL_MS = 5_000
const ENTRY_CACHE_MAX = 100

function normalizeCacheKey(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ')
}

async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  if (message.kind !== 'text') return null

  // [R1] Include isFirstInbound in cache key — a first_inbound_message
  // flow and a keyword flow may both match the same text but return
  // different flows depending on whether this is the contact's first
  // inbound message.
  const cacheKey = `${userId}:${+isFirstInbound}:${normalizeCacheKey(message.text)}`
  const cached = entryFlowCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.flow

  // ... existing DB query ...

  // FIFO eviction
  if (entryFlowCache.size >= ENTRY_CACHE_MAX) {
    const oldest = entryFlowCache.keys().next().value
    if (oldest !== undefined) entryFlowCache.delete(oldest)
  }
  entryFlowCache.set(cacheKey, { flow: result, expiresAt: Date.now() + ENTRY_CACHE_TTL_MS })
  return result
}
```

**Changes from v1.1:**
- Cache key now includes `isFirstInbound` as `0` or `1` prefix: `` `${userId}:${+isFirstInbound}:${normalizeCacheKey(message.text)}` `` [R1]

**With Redis:** See B4 below.

---

## Track B — Redis Integration (optional, opt-in)

### B0 — Dependency & Connection  [R6: FIXED — PARAMETER RENAMED]

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

/** [R6] Parameter renamed from `redis` to `r` to avoid shadowing
 *  the imported `Redis` type. */
export async function redisSafe<T>(
  fn: (r: Redis) => Promise<T>,
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

**File:** `.env.local.example` (project root) — add
```
# Redis — optional. Makes rate limiting, webhook dedup, and phone
# variant caching work across instances. Without it, all features
# fall back to in-memory / DB defaults.
# REDIS_URL=redis://default:password@localhost:6379
```

---

### B1 — Redis-backed rate limiter (optional wrapper)  [No changes from v1.1]

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
    async (r) => {           // [R6] `redis` → `r`
      const c = await r.incr(redisKey)
      if (c === 1) await r.expire(redisKey, Math.ceil(windowMs / 1000))
      return c
    },
    null,
  )

  // Redis fallback
  if (count === null) {
    return checkRateLimit(key, { limit, windowMs })
  }

  if (count > limit) {
    const ttl = await redisSafe(
      (r) => r.ttl(redisKey),  // [R6] `redis` → `r`
      Math.ceil(windowMs / 1000),
    )
    return { success: false, remaining: 0, reset: now + ttl * 1000, limit }
  }
  return { success: true, remaining: limit - count, reset: now + windowMs, limit }
}
```

**Call sites** — optionally switch by adding `await`:
```ts
const limit = await checkRateLimitWithRedis(`send:${user.id}`, RATE_LIMITS.send)
```
Files to update:
- `src/app/api/whatsapp/send/route.ts:36`
- `src/app/api/whatsapp/broadcast/route.ts:67`

---

### B2 — Webhook deduplication  [No changes from v1.1]

**File:** `src/app/api/whatsapp/webhook/route.ts` — insert before `processWebhook()`

```ts
import { redisSafe } from '@/lib/redis/client'

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
    (r) => r.set(key, '1', 'EX', 30, 'NX'),  // [R6] `redis` → `r`
    null,
  )
  if (ok === null) {
    break  // Redis unavailable — skip dedup
  }
  if (!ok) {
    console.log('[webhook] duplicate', id, 'skipped')
    return NextResponse.json({ status: 'duplicate' }, { status: 200 })
  }
}
```

---

### B3 — Phone variant cache  [R7: FIXED — DUAL INTEGRATION SHOWN FOR flows/meta-send.ts]

**Files to modify (4 files):**

| # | File | Functions | Integration points |
|---|------|-----------|-------------------|
| 1 | `src/lib/automations/meta-send.ts` | `engineSendText`, `engineSendTemplate` | Inside `sendViaMeta()`, before `const variants` |
| 2 | `src/lib/flows/meta-send.ts` | `engineSendText`, `engineSendInteractiveButtons`, `engineSendInteractiveList` | **Two independent loops** — `engineSendText` (lines 92-107) and `sendInteractiveViaMeta` (lines 255-270) each need cache check |
| 3 | `src/app/api/whatsapp/send/route.ts` | POST handler | Before `const variants` on line 203 |
| 4 | `src/app/api/whatsapp/broadcast/route.ts` | POST handler | Per-recipient in loop (no contactId — cache skipped) |

**File:** `src/lib/redis/helpers.ts`
```ts
const PHONE_CACHE_TTL = 86_400 // 24 hours

export async function getCachedPhone(contactId: string): Promise<string | null> {
  return redisSafe(
    (r) => r.get(`wacrm:phone:${contactId}`),   // [R6] `redis` → `r`
    null,
  )
}

export async function setCachedPhone(contactId: string, phone: string): Promise<void> {
  await redisSafe(
    (r) => r.set(`wacrm:phone:${contactId}`, phone, 'EX', PHONE_CACHE_TTL),  // [R6]
    undefined,
  )
}

export async function invalidateCachedPhone(contactId: string): Promise<void> {
  await redisSafe(
    (r) => r.del(`wacrm:phone:${contactId}`),   // [R6]
    undefined,
  )
}
```

**Integration pattern:**

For files 1, 2 (`engineSendText` pattern in `flows/meta-send.ts`), and 3:
```ts
// Before the variant loop
const cachedPhone = await getCachedPhone(contact.id)
const variants = cachedPhone
  ? [cachedPhone, ...phoneVariants(sanitized).filter(v => v !== cachedPhone)]
  : phoneVariants(sanitized)

// After variant loop, successful send:
if (workingPhone !== sanitized || !cachedPhone) {
  await setCachedPhone(contact.id, workingPhone)
}
```

For file 2 (`sendInteractiveViaMeta` — second independent integration):
```ts
// Same pattern, in sendInteractiveViaMeta before its variant loop.
// Both engineSendText and sendInteractiveViaMeta in flows/meta-send.ts
// need independent cache checks — they are separate code paths called
// from different node types.
```

For file 4 (broadcast, no contactId):
```ts
// Broadcast uses recipient.phone directly, not contact.id.
// The phone-variant retry loop remains unchanged.
// If the new recipient shape included contactId, use:
if (recipient.contactId) {
  const cached = await getCachedPhone(recipient.contactId)
  if (cached) variants = [cached, ...variants.filter(v => v !== cached)]
}
```

---

### B4 — Redis-backed entry flow cache  [R1: FIXED — isFirstInbound IN REDIS KEY TOO]

**File:** `src/lib/flows/engine.ts` — extend `findEntryFlow`

```ts
async function findEntryFlow(db, userId, message, isFirstInbound): Promise<FlowRow | null> {
  if (message.kind !== 'text') return null

  // [R1] Include isFirstInbound in Redis key (same fix as A7)
  const cacheKey = `wacrm:flow:entry:${userId}:${+isFirstInbound}:${normalizeCacheKey(message.text)}`

  // Redis check
  const cached = await redisSafe(
    (r) => r.get(cacheKey),   // [R6] `redis` → `r`
    null,
  )
  if (cached !== null) {
    if (cached === 'NULL') return null
    return JSON.parse(cached) as FlowRow
  }

  // ... existing DB query ...

  // Cache result
  if (result) {
    await redisSafe(
      (r) => r.set(cacheKey, JSON.stringify(result), 'EX', 5),
      undefined,
    )
  } else {
    await redisSafe(
      (r) => r.set(cacheKey, 'NULL', 'EX', 5),
      undefined,
    )
  }

  return result
}
```

---

### B5 — Real-time wait steps (optional, advanced)  [R8: FIXED — SCHEDULER INITIALIZATION SPECIFIED]

**Current:** Wait steps write to `automation_pending_executions` DB table. A cron polls every N minutes.

**With Redis:** In addition to the DB row, push a sorted-set entry:
```ts
import { redisSafe } from '@/lib/redis/client'

const runAtEpoch = Date.now() + ms
const pendingId = pendingRow.id

await redisSafe(
  (r) => r.zadd('wacrm:pending', runAtEpoch, pendingId),
  undefined,
)
```

A lightweight in-process scheduler picks due items:
```ts
async function processDuePendings() {
  const due = await redisSafe(
    (r) => r.zrangebyscore('wacrm:pending', 0, Date.now()),
    [],
  )
  for (const id of due) {
    await redisSafe(
      (r) => r.zrem('wacrm:pending', id),
      undefined,
    )
    // ... resume execution via resumePendingExecution()
  }
  setTimeout(processDuePendings, 1000)
}

// [R8] Module-level invocation: start the scheduler when the module is
// first loaded. This works in long-running VPS processes. The cron
// endpoint remains the safety net for all deployment targets.
processDuePendings()
```

**⚠️ SERVERLESS LIMITATION:** `setTimeout`-based scheduling only works in long-running Node.js processes (self-hosted VPS, bare metal). On serverless platforms (Vercel, Netlify), the scheduler dies when the function returns. The DB cron remains as safety net for all deployment targets.

**Why:** Wait steps resume within ~1 second instead of waiting for the next cron tick.

---

## Track C — AI-Powered Smart Reply for Inbox

### Background
The app already has an AI Automation chat assistant under `/api/ai-automation` that uses `callAi()` from `src/lib/ai/provider.ts`. The same AI provider is reused.

### Design Decisions

#### 1. No new dependencies
Reuse `callAi()` from `src/lib/ai/provider.ts`.

#### 2. Add `responseFormat` parameter to `callAi()`  [R2: FIXED — NEW PARAMETER]
The OpenAI-compatible API supports `response_format: { type: "json_object" }` for guaranteed JSON output. A new optional parameter is added to `callAi()` (backward-compatible — defaults to `undefined`, which preserves existing behavior).

#### 3. No breaking changes to the send flow
The AI button only **fills the textarea** or **shows a template/flow recommendation chip**.

#### 4. Two modes in one button
- **Auto-suggest**: Empty textarea → AI writes a reply from context
- **Guided**: Agent types instructions → AI incorporates them

#### 5. Context memory: last 10 messages
The API fetches the last 10 messages.

#### 6. Template-aware AI
The API fetches the user's **approved** message templates. **Only name and category** are included in the prompt to save tokens. The full body_text is retrieved server-side when the AI selects a template.

#### 7. Flow-aware AI
The API fetches the user's **active** flows (name, trigger_type only).

#### 8. Fallback when AI is not configured
If `AI_API_KEY` is not set, the button shows a tooltip "AI not configured".

#### 9. Three-column response structure
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

### C0 — Modify `callAi()` to support JSON response format  [R2: NEW]

**File:** `src/lib/ai/provider.ts` — add optional `responseFormat` parameter

```ts
export async function callAi(
  messages: AiMessage[],
  tools?: object[],
  responseFormat?: { type: "json_object" },  // [R2] NEW optional param
): Promise<AiResponse> {
  const { baseUrl, apiKey, model } = getConfig()

  if (!apiKey) {
    throw new Error(
      "AI_API_KEY or OPENAI_API_KEY environment variable is not set. " +
        "To use the AI-powered CRM assistant, set one of these variables."
    )
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 1024,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = "auto"
  }

  // [R2] Pass response_format when requested (enables guaranteed JSON output)
  if (responseFormat) {
    body.response_format = responseFormat
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI API error (${res.status}): ${err}`)
  }

  return res.json()
}
```

**Why:** Without `response_format`, the AI may return non-JSON text despite the prompt instruction "Return ONLY valid JSON." This parameter forces the model to emit only valid JSON objects.

---

### C1 — API endpoint `POST /api/ai-reply/suggest`  [R3, R4: FIXED]

**File**: `src/app/api/ai-reply/suggest/route.ts` (NEW)

**Changes from v1.1:**
- Calls `callAi()` with `responseFormat: { type: "json_object" }` (via C0) [R2]
- Uses `max_tokens: 2048` for this endpoint (longer replies) [R4]
- Template ID resolution documented explicitly [R3]
- `tryExtractJson()` helper for robust JSON parsing [R5]

**Flow:**
1. Auth via Supabase server client
2. Rate-limit via `await checkRateLimitWithRedis(`ai_reply:${user.id}`, RATE_LIMITS.ai_reply)`
3. Validate `conversation_id`, fetch conversation + contact
4. Fetch last 10 messages (`ORDER BY created_at DESC LIMIT 10`, then reverse)
5. Fetch user's approved templates — **only name & category** (not body_text). Filter by `LOWER(status) = 'approved'`. Limit to 30.
6. Fetch user's **active** flows — name, trigger_type only. Limit to 10.
7. Check if contact has an active flow run
8. Call `callAi()` with the prompt, `responseFormat: { type: "json_object" }`, and `max_tokens: 2048`
9. Parse JSON from `response.choices[0].message.content` using `tryExtractJson()` [R5]
10. **[R3]** If template selected (`type === "template"`):
    - AI returns only the template `name` — look up the template by name to get its `id` and `body_text`
    - Query: `SELECT id, body_text FROM message_templates WHERE user_id = ? AND LOWER(name) = LOWER(?)`
    - Return both `id` and `name` in the response
11. Return the full response
12. On AI error: return `{ suggestion: null, error: "..." }`

**Rate limit entry:** Add `ai_reply: { limit: 30, windowMs: 60_000 }` to `RATE_LIMITS` in `src/lib/rate-limit.ts`.

---

### C2 — AI Reply button in MessageComposer  [R10: FIXED — USE REACT CONTEXT INSTEAD OF PROP DRILLING]

**Instead of 3-level prop drilling (MessageThread → MessageComposer → AiReplyButton), use a lightweight React context.**

**NEW file:** `src/lib/ai/context.tsx`
```tsx
'use client'

import { createContext, useContext, useCallback, useState } from 'react'

interface AiContextValue {
  onSuggestion: (text: string) => void
  onSendTemplate: (name: string, params: string[]) => void
  onTriggerFlow: (flowId: string, action: 'trigger' | 'resume') => void
}

const AiContext = createContext<AiContextValue | null>(null)

export function AiProvider({ children, onSendTemplate, onTriggerFlow }: {
  children: React.ReactNode
  onSendTemplate: (name: string, params: string[]) => void
  onTriggerFlow: (flowId: string, action: 'trigger' | 'resume') => void
}) {
  const [suggestionTarget, setSuggestionTarget] = useState<((text: string) => void) | null>(null)

  const onSuggestion = useCallback((text: string) => {
    suggestionTarget?.(text)
  }, [suggestionTarget])

  return (
    <AiContext.Provider value={{ onSuggestion, onSendTemplate, onTriggerFlow }}>
      {children}
    </AiContext.Provider>
  )
}

export function useAi(): AiContextValue {
  const ctx = useContext(AiContext)
  if (!ctx) throw new Error('useAi must be used within AiProvider')
  return ctx
}
```

**Wrap in MessageThread:**
```tsx
<AiProvider onSendTemplate={handleSendTemplate} onTriggerFlow={handleTriggerFlow}>
  <MessageComposer ... />
</AiProvider>
```

**In MessageComposer — render AiReplyButton:** Import and render `<AiReplyButton>` as a sibling of the template button. No new callback props needed — `AiReplyButton` calls `useAi()` directly.

**NEW file:** `src/components/inbox/ai-reply-button.tsx`
- `Sparkles` icon button
- Loading spinner state
- Fetches `POST /api/ai-reply/suggest`
- Uses `useAi()` from context for callbacks
- Action chips for template/flow recommendations rendered here

**Changes from v1.1:** Callbacks flow through React context instead of 3-level prop drilling. MessageComposer only adds the `<AiReplyButton>` JSX, no new props. [R10]

---

### C3 — Wire up template/flow recommendations through parent

**File**: `src/components/inbox/message-thread.tsx` (MODIFY)

- Wrap content in `<AiProvider>` providing:
  - `onSendTemplate(name, params)` — calls `POST /api/whatsapp/send` with template, shows optimistic message
  - `onTriggerFlow(flowId, action)` — starts/resumes a flow run
- These are additive callbacks, do not modify existing `onSend` or `handleSend`

---

### C4 — Prompt engineering  [R5: FIXED — ROBUST JSON EXTRACTION]

**File**: `src/lib/ai/reply-prompt.ts` (NEW) — exports `buildReplyPrompt()` function

**File:** `src/lib/ai/reply-prompt.ts`
```ts
export function buildReplyPrompt(params: {
  contactName: string
  contactPhone: string
  agentName: string
  messages: { role: string; text: string }[]
  agentText: string
  templates: { name: string; category: string }[]
  flows: { name: string; trigger_type: string }[]
  activeFlowName?: string
}): AiMessage[] {
  const { contactName, contactPhone, agentName, messages, agentText, templates, flows, activeFlowName } = params

  const system: AiMessage = {
    role: 'system',
    content: `You are an AI reply assistant for a WhatsApp CRM.

## Contact
Name: ${contactName}
Phone: ${contactPhone}

## Agent
${agentName}

## Available Message Templates (names only)
${templates.map((t, i) => `${i + 1}. "${t.name}" (${t.category})`).join('\n')}

## Active Flows (names only)
${flows.map((f, i) => `${i + 1}. "${f.name}" (${f.trigger_type})`).join('\n')}

## Active Flow Run
${activeFlowName ? `Contact has an active run of "${activeFlowName}"` : 'None'}

## Your Task
Read the conversation and agent instructions.
- If a template fits perfectly, respond with JSON: {"type":"template","name":"...","params":[...]}
- If a flow matches the conversation intent, respond with JSON: {"type":"flow","name":"...","action":"trigger"}
- Otherwise, respond with JSON: {"type":"reply","text":"..."}

Return ONLY valid JSON, no other text.`
  }

  const conversation: AiMessage = {
    role: 'user',
    content: `## Agent's Instructions
${agentText || 'Suggest a natural reply.'}

## Conversation History (last ${messages.length} messages, newest last)
${messages.map(m => `${m.role}: ${m.text}`).join('\n')}

Respond with JSON.`,
  }

  return [system, conversation]
}
```

**Parsing with robust extraction [R5]:**
```ts
/** [R5] Try to extract JSON from AI output, stripping markdown code
 *  fences if present. Some models wrap JSON in ```json ... ``` blocks
 *  despite prompt instructions. */
function tryExtractJson(raw: string): unknown {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw.trim()]
  try { return JSON.parse(jsonMatch[1]) } catch { return null }
}
```

**Usage in C1 route:**
```ts
const raw = choice.message.content
const result = tryExtractJson(raw)
if (!result) return { suggestion: null, error: 'AI returned invalid JSON' }

const { type, text, name, params, action } = result as any
```

---

## Testing Plan  [R11: FIXED — CACHE TESTED AS PURE HELPER]

| Module | Test file | What to test |
|--------|-----------|-------------|
| `redis/client.ts` | `src/lib/redis/client.test.ts` | `getRedis()` returns null without REDIS_URL; `redisSafe()` returns fallback on error |
| `redis/helpers.ts` | `src/lib/redis/helpers.test.ts` | `getCachedPhone` / `setCachedPhone` with Redis mock |
| `rate-limit.ts` (B1) | `src/lib/rate-limit.test.ts` (extend) | `checkRateLimitWithRedis` falls back to sync `checkRateLimit` |
| `ai/reply-prompt.ts` | `src/lib/ai/reply-prompt.test.ts` | Renders prompt with all fields; handles empty states |
| `ai/provider.ts` (C0) | `src/lib/ai/provider.test.ts` | `callAi` with `responseFormat` passes it in request body |
| `flows/engine.ts` (A7) | `src/lib/flows/engine.test.ts` (extend) | **[R11]** Extract cache helpers as pure functions and test them directly — test `normalizeCacheKey()`, cache key format with `isFirstInbound`, expiry/MRU eviction logic without needing a Supabase mock |
| `automations/engine.ts` (A2) | (manual review) | Race condition audit document |
| `components/inbox/ai-reply-button.tsx` | Manual | UI-only, verify button states |

**[R11 Detail]** The A7 cache logic should be extracted into pure helper functions in `engine.ts`:

```ts
// Pure helpers — testable without Supabase mock
export function makeEntryFlowCacheKey(userId: string, isFirstInbound: boolean, text: string): string {
  return `${userId}:${+isFirstInbound}:${normalizeCacheKey(text)}`
}

// Test in engine.test.ts:
// - makeEntryFlowCacheKey includes isFirstInbound
// - normalizeCacheKey trims/collapses whitespace
// - Entry expiry via setTimeout
// - Max size eviction (FIFO)
```

---

## Combined Security & Compatibility Guarantees

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
| **A7 cache key** | Includes `isFirstInbound` — no stale cross-trigger hits [R1] |
| **AI JSON response** | Uses `response_format: { type: "json_object" }` + fallback `tryExtractJson()` [R2], [R5] |
| **callAi()** | Backward-compatible — optional `responseFormat` param defaults to `undefined` [R2] |

---

## Files Changed Summary

| File | Action | Track | Change from v1.1 |
|------|--------|-------|----------------|
| `supabase/migrations/015_add_contacts_user_phone_index.sql` | CREATE | A1, A5, A6 | — |
| `src/lib/automations/engine.ts` | MODIFY | A2, A3 | A2: serial shown as default, parallel as opt-in [R9] |
| `src/app/api/whatsapp/webhook/route.ts` | MODIFY | A4, B2 | — |
| `src/lib/flows/engine.ts` | MODIFY | A7, B4 | A7/B4: cache key includes `isFirstInbound` [R1]; extract `makeEntryFlowCacheKey` for testing [R11] |
| `src/lib/redis/client.ts` | CREATE | B0 | `redisSafe` param renamed `redis` → `r` [R6] |
| `.env.local.example` | MODIFY | B0 | — |
| `src/lib/rate-limit.ts` | MODIFY | B1, C1 | B1: `r` param [R6]. C1: `ai_reply` key |
| `src/lib/redis/helpers.ts` | CREATE | B3 | `r` param [R6] |
| `src/lib/automations/meta-send.ts` | MODIFY | B3 | Cache integration |
| `src/app/api/whatsapp/send/route.ts` | MODIFY | B3 | Cache integration |
| `src/lib/flows/meta-send.ts` | MODIFY | B3 | **Dual integration** — `engineSendText` + `sendInteractiveViaMeta` [R7] |
| `src/app/api/whatsapp/broadcast/route.ts` | MODIFY | B3 | Conditional cache when contactId available |
| `src/lib/ai/provider.ts` | MODIFY | C0 | NEW — `responseFormat` optional param [R2] |
| `src/app/api/ai-reply/suggest/route.ts` | CREATE | C1 | JSON `responseFormat` [R2]; template ID lookup [R3]; 2048 max_tokens [R4]; `tryExtractJson` [R5] |
| `src/lib/ai/reply-prompt.ts` | CREATE | C4 | JSON output format; includes `tryExtractJson` helper [R5] |
| `src/lib/ai/context.tsx` | CREATE | C2 | NEW — React context instead of prop drilling [R10] |
| `src/components/inbox/message-composer.tsx` | MODIFY | C2 | Import `<AiReplyButton>`, no new props [R10] |
| `src/components/inbox/ai-reply-button.tsx` | CREATE | C2 | Uses `useAi()` from context [R10] |
| `src/components/inbox/message-thread.tsx` | MODIFY | C3 | Wraps content in `<AiProvider>` |
| `src/lib/redis/client.test.ts` | CREATE | B0 | Redis safe wrapper tests |
| `src/lib/redis/helpers.test.ts` | CREATE | B3 | Phone cache tests |
| `src/lib/ai/provider.test.ts` | CREATE | C0 | NEW — `responseFormat` param test |
| `src/lib/ai/reply-prompt.test.ts` | CREATE | C4 | Prompt builder tests |

---

## Recommended Implementation Order (Updated)

### Phase 0 — Fix `callAi()` (C0)
1. **C0** — Add optional `responseFormat` param to `callAi()` in `src/lib/ai/provider.ts`
2. **C0** — Write `src/lib/ai/provider.test.ts`

### Phase 1 — Low-effort, immediate wins (A1 + A5 + A6)
Create the migration file with all 3 indexes. Run migration.

### Phase 2 — No-Redis performance (A3 → A4 → A7 → A2)
1. **A3** — Minor `resolveConversationId` cache
2. **A4** — Direct phone lookup with `.limit(2)` guard
3. **A7** — In-memory entry flow cache (key includes `isFirstInbound` [R1]; extract `makeEntryFlowCacheKey` for testing [R11])
4. **A2** — Parallel automations (serial remains default; parallel is documented opt-in [R9])

### Phase 3 — Redis foundation (B0 + B1)
1. **B0** — Install `ioredis`, create `src/lib/redis/client.ts` with `redisSafe()` (param `r` not `redis` [R6])
2. **B0** — Write `src/lib/redis/client.test.ts`
3. **B1** — Add `checkRateLimitWithRedis` using `redisSafe()`

### Phase 4 — Redis reliability wins (B2 + B3)
1. **B2** — Webhook dedup with `redisSafe()`
2. **B3** — Phone cache across all 4 sender files + `helpers.test.ts` (dual integration for `flows/meta-send.ts` [R7])

### Phase 5 — Redis caching (B4)
1. **B4** — Redis entry flow cache (key includes `isFirstInbound` [R1])

### Phase 6 — AI Smart Reply (C4 → C1 → C2 → C3)
1. **C4** — Prompt builder with JSON output + `tryExtractJson()` [R5]
2. **C1** — API endpoint with `ai_reply` rate limit, `responseFormat` [R2], 2048 max_tokens [R4], template ID lookup [R3]
3. **C2** — Create `AiContext` + `AiProvider` + `AiReplyButton` [R10], integrate in `MessageComposer`
4. **C3** — Wrap content in `<AiProvider>` in `MessageThread`

### Phase 7 — Advanced (B5, defer)
1. **B5** — Real-time wait steps with module-level `processDuePendings()` invocation [R8]

---

## Summary of All R-Fixes

| ID | Severity | Issue | Fix | File(s) |
|----|----------|-------|-----|---------|
| **R1** | 🟠 Medium | A7/B4 cache key missing `isFirstInbound` | Include `+isFirstInbound` in cache key | `src/lib/flows/engine.ts` |
| **R2** | 🟠 Medium | `callAi()` lacks JSON response format support | Add optional `responseFormat` param | `src/lib/ai/provider.ts` |
| **R3** | 🟡 Low | Template ID not in AI prompt | Look up template by name after AI response | `src/app/api/ai-reply/suggest/route.ts` |
| **R4** | 🟡 Low | 1024 max_tokens may truncate reply | Use 2048 for AI reply endpoint | `src/app/api/ai-reply/suggest/route.ts` |
| **R5** | 🟡 Low | JSON parsing needs robust extraction | Add `tryExtractJson()` helper with markdown fence stripper | `src/lib/ai/reply-prompt.ts` |
| **R6** | 🟡 Low | `redisSafe` param shadows `Redis` type | Rename `redis` → `r` | `src/lib/redis/client.ts` |
| **R7** | 🟡 Low | `flows/meta-send.ts` has 2 separate loop patterns | Show integration for both `engineSendText` and `sendInteractiveViaMeta` | `src/lib/flows/meta-send.ts` |
| **R8** | 🟡 Low | B5 scheduler initialization unspecified | Add module-level `processDuePendings()` call | `src/lib/automations/engine.ts` (or new B5 file) |
| **R9** | 🟡 Low | A2 serial vs parallel mode confusion | Serial shown as default; parallel as opt-in with race docs | `src/lib/automations/engine.ts` |
| **R10** | 🟡 Low | C2 3-level prop drilling | Use React context (`AiProvider`/`useAi`) | `src/lib/ai/context.tsx` (NEW) |
| **R11** | 🟡 Low | A7 cache tests need Supabase mock | Extract `makeEntryFlowCacheKey` as pure helper; test cache logic directly | `src/lib/flows/engine.ts` + test |

(End of file)
