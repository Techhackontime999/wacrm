# Plan 01 — AI-Powered Smart Reply for Inbox

## Goal
Add an **AI reply suggestion** button to the inbox composer that generates contextual replies using the existing AI provider (`AI_API_BASE`, `AI_API_KEY`, `AI_MODEL` from `.env.local`). The AI is also aware of the user's **message templates** and **active flows** so it can recommend them when appropriate. The agent can accept the suggestion, edit it, use a recommended template, or ignore it — the existing manual reply flow is untouched.

## Background
The app already has an AI Automation chat assistant under `/api/ai-automation` that uses `callAi()` from `src/lib/ai/provider.ts`. The same AI provider is available for a new purpose: helping agents write replies faster in the inbox.

Existing tables the AI will query:
- `message_templates` — approved WhatsApp message templates (name, body_text, category, language)
- `flows` — active flows with their trigger types and names
- `flow_runs` — to check if this contact currently has an active flow run

## Design Decisions

### 1. No new dependencies
Reuse `callAi()` from `src/lib/ai/provider.ts` — same OpenAI-compatible API, same env vars.

### 2. No breaking changes to the send flow
The AI button only **fills the textarea** or **shows a template recommendation chip**. The agent still clicks Send or the template chip as before. Zero changes to existing `handleSend`, `onSend`, or the send API route.

### 3. Two modes in one button
- **Auto-suggest**: Agent clicks AI button with an empty textarea → AI writes a reply from conversation context + available templates/flows.
- **Guided**: Agent types partial instructions (e.g. "offer 20% off, sound urgent") then clicks AI → AI incorporates those instructions into the reply.

### 4. Context memory: last 10 messages
The API fetches the last 10 messages in the conversation and includes them in the prompt. This gives the AI enough context for coherent replies without blowing the token budget.

### 5. Template-aware AI
The API fetches the user's **approved** message templates (name, body_text, category) and includes them in the system prompt. The AI can:
- Select a matching template and recommend it with filled parameters
- Fall back to a free-text reply when no template fits
- Return `template_recommendation` in the response when it finds a match

### 6. Flow-aware AI
The API fetches the user's **active** flows (name, trigger_type) and checks if this contact has an **active flow run**. The AI can:
- Suggest triggering a flow if the contact's intent matches (e.g. "This looks like a lead — should I start the Lead Capture flow?")
- Suggest resuming a paused flow run
- Return `flow_suggestion` in the response

### 7. Fallback when AI is not configured
If `AI_API_KEY` is not set, the button does nothing / shows a tooltip "AI not configured". No crash, no error.

### 8. Three-column response structure
```typescript
interface AiReplyResponse {
  suggestion: string | null;          // free-text reply suggestion
  template_recommendation: {          // optional template match
    id: string;
    name: string;
    params: string[];                 // filled parameter values
  } | null;
  flow_suggestion: {                  // optional flow match
    id: string;
    name: string;
    action: "trigger" | "resume";     // start new or resume existing
  } | null;
  error?: string;
}
```

---

## Implementation Plan

### Item 1 — API endpoint `POST /api/ai-reply/suggest`   (risk: low)

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
8. Build system prompt with:
   - Contact name, phone, company
   - Agent's display name (from user profile)
   - The 10-message conversation history
   - The agent's partial text instructions (if any)
   - Available templates as a numbered list with body_text placeholders
   - Available active flows as a numbered list
   - Active flow run indicator (if any)
   - Instructions: AI should pick the best template if one matches the intent, otherwise write a free-text reply. It can also suggest a flow if the conversation fits.
9. Call `callAi()` with the prompt
10. Parse the AI's response — try to extract structured output (template match, flow match, suggestion text)
11. Return the full response
12. On AI error: return `{ suggestion: null, error: "..." }` — the frontend shows a toast

**Rate limit entry**: Add `aiReply: { limit: 30, windowMs: 60_000 }` to `RATE_LIMITS` in `src/lib/rate-limit.ts`.

**Security**:
- Conversation ownership verified by `user_id` match (same pattern as `send/route.ts`)
- No data from one user's conversations leaks to another
- AI provider call uses the server-side API key only

---

### Item 2 — AI Reply button in MessageComposer   (risk: low)

**File**: `src/components/inbox/message-composer.tsx` (MODIFY)

**Changes**:
1. Add a new `Sparkles` icon button (the "AI" button) next to the template button, before the textarea
2. Add state for AI loading and AI suggestion data
3. On click:
   - If already loading, ignore
   - Read current `text` from state → this becomes `agent_text`
   - Set `aiLoading = true`
   - Fetch `POST /api/ai-reply/suggest` with `{ conversation_id, agent_text }`
   - On success:
     - If `suggestion` is present: `setText(suggestion)` — fills the textarea
     - If `template_recommendation` is present: show a template chip/button below the textarea that, when clicked, opens the template picker pre-filled with that template and params
     - If `flow_suggestion` is present: show a small action chip ("Start Lead Flow" / "Resume Flow")
   - On error: `toast.error("AI reply failed: ...")`
   - Set `aiLoading = false`
4. The AI button shows a spinner while loading, disabled when `sessionExpired`
5. The AI button is disabled (grayed out) when `conversationId` is empty

**No changes to `onSend` or existing button behavior** — the AI just writes into the textarea and optionally surfaces template/flow recommendations.

**Template chip click** → opens the template picker modal with the recommended template pre-selected and params filled, so the agent just clicks Send.

**Prop changes**: No new props needed. `conversationId` is already passed; `onOpenTemplates` exists. We may need to pass a new callback `onOpenTemplateWithParams` or reuse the existing template flow.

---

### Item 3 — Wire up template/flow recommendations through parent   (risk: low)

**File**: `src/components/inbox/message-thread.tsx` (MODIFY)

- Expose a new prop or callback to `MessageComposer` for triggering a template with pre-filled params
- Example: `onSendTemplate(name, params)` that opens the template picker and pre-fills params
- Or simpler: when AI recommends a template, immediately call `handleSendTemplate` with the template name and params (bypass the picker). The agent sees the message sent immediately — faster UX.

**Preferred approach**: The AI template recommendation is a "one-click send" button. When the agent clicks the template chip:
1. Call `POST /api/whatsapp/send` directly with `{ conversation_id, message_type: "template", template_name, template_params }`
2. Show optimistic message in the thread
3. No need to open the template picker at all — the AI already filled the params

This is faster and more impressive. The agent can still use the manual template button separately.

**Flow suggestion click**: When the agent clicks a flow suggestion chip:
1. `POST /api/flows/{id}/runs` to start a new run (or resume existing)
2. Toast "Flow started for {contact_name}"
3. If it's a "resume" action, `PATCH /api/flow-runs/{id}/resume` (or equivalent endpoint)

---

### Item 4 — Graceful fallback when AI is unconfigured   (risk: none)

**File**: `src/app/api/ai-reply/suggest/route.ts`

If `AI_API_KEY` is not set (check `getConfig()` from provider), return:
```json
{ "suggestion": null, "error": "AI is not configured. Set AI_API_KEY in your environment." }
```

The frontend shows a toast; the button still works on the next attempt if config changes.

---

### Item 5 — Prompt engineering (key to quality)

**File**: `src/lib/ai/reply-prompt.ts` (NEW) — exports `buildReplyPrompt()` function

The prompt structure:
```
You are an AI reply assistant for a WhatsApp CRM. You help agents write replies to customers.

## Contact
Name: {name}
Phone: {phone}
Company: {company}

## Agent
{agent_name}

## Conversation History (last 10 messages, newest last)
{formatted messages}

## Agent's Instructions
{agent_text: "Be concise and professional"}

## Available Message Templates
{numbered list of templates with name and body_text}

## Active Flows
{numbered list of active flows}

## Active Flow Run
{contact has an active run of "FAQ Bot"}

## Your Task
- Read the conversation and agent instructions.
- Choose the MOST SPECIFIC matching template if one fits the intent perfectly, OR write a natural reply.
- If suggesting a template, return: TEMPLATE: name | param1 | param2
- If suggesting a flow, return: FLOW: name | trigger | resume
- Otherwise return: REPLY: your suggestion text
```

The AI returns one line with structured output, which the API parses:
- `TEMPLATE: name | param1 | param2` → sets `template_recommendation`
- `FLOW: name | trigger` → sets `flow_suggestion`
- `REPLY: text` → sets `suggestion`

This structured parsing is simpler than function calling and works with any OpenAI-compatible provider.

---

## Files Changed Summary

| File | Action | Lines |
|------|--------|-------|
| `src/app/api/ai-reply/suggest/route.ts` | CREATE | ~120 |
| `src/lib/ai/reply-prompt.ts` | CREATE | ~60 |
| `src/components/inbox/message-composer.tsx` | MODIFY | ~+50 |
| `src/components/inbox/message-thread.tsx` | MODIFY | ~+15 |
| `src/lib/rate-limit.ts` | MODIFY | +1 line |

---

## Safety / Non-breaking Guarantees

- Existing `handleSend`, `onSend`, `POST /api/whatsapp/send` are completely untouched
- The AI button only modifies local `text` state or shows recommendation chips
- Template recommendation is a one-click send — same `POST /api/whatsapp/send` endpoint, same validation
- Flow recommendation calls the existing `POST /api/flows/{id}/runs` endpoint
- If the API fails or AI is not configured, the textarea content is unchanged
- Rate limiting prevents abuse
- All DB queries verify `user_id` ownership

---

## Future Ideas (not in scope)

- **Tone selector**: Professional / Friendly / Concise dropdown next to the AI button
- **Language override**: "Reply in Spanish" as part of the agent_text
- **Custom persona**: Agent writes their "voice" instructions in settings, included in each AI prompt
- **Quick actions**: "/summarize" fills a summary, "/translate" translates last message
- **Template usage analytics**: Track which AI-recommended templates are accepted/rejected
