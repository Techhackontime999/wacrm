import type { AiMessage } from "./types"

export interface BuildReplyPromptParams {
  contactName: string
  contactPhone: string
  agentName: string
  messages: { role: string; text: string }[]
  agentText: string
  templates: { name: string; category: string }[]
  flows: { name: string; trigger_type: string }[]
  activeFlowName?: string
}

export function buildReplyPrompt(params: BuildReplyPromptParams): AiMessage[] {
  const { contactName, contactPhone, agentName, messages, agentText, templates, flows, activeFlowName } = params

  const system: AiMessage = {
    role: "system",
    content: `You are an AI reply assistant for a WhatsApp CRM.

## Contact
Name: ${contactName}
Phone: ${contactPhone}

## Agent
${agentName}

## Available Message Templates (names only)
${templates.map((t, i) => `${i + 1}. "${t.name}" (${t.category})`).join("\n")}

## Active Flows (names only)
${flows.map((f, i) => `${i + 1}. "${f.name}" (${f.trigger_type})`).join("\n")}

## Active Flow Run
${activeFlowName ? `Contact has an active run of "${activeFlowName}"` : "None"}

## Your Task
Read the conversation and agent instructions.
- If a template fits perfectly, respond with JSON: {"type":"template","name":"...","params":[...]}
- If a flow matches the conversation intent, respond with JSON: {"type":"flow","name":"...","action":"trigger"}
- Otherwise, respond with JSON: {"type":"reply","text":"..."}

Return ONLY valid JSON, no other text.`,
  }

  const conversation: AiMessage = {
    role: "user",
    content: `## Agent's Instructions
${agentText || "Suggest a natural reply."}

## Conversation History (last ${messages.length} messages, newest last)
${messages.map((m) => `${m.role}: ${m.text}`).join("\n")}

Respond with JSON.`,
  }

  return [system, conversation]
}

/** [R5] Extract JSON from AI output, stripping markdown code fences
 *  if present. Some models wrap JSON in ```json ... ``` despite
 *  prompt instructions. */
export function tryExtractJson(raw: string): unknown {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw.trim()]
  try { return JSON.parse(jsonMatch[1]) } catch { return null }
}
