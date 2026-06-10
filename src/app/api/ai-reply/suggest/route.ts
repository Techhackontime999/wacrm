import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAi } from "@/lib/ai/provider"
import { buildReplyPrompt, tryExtractJson } from "@/lib/ai/reply-prompt"
import {
  checkRateLimitWithRedis,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit"

interface AiReplyResponse {
  suggestion?: string | null
  template_recommendation?: {
    id: string
    name: string
    params: string[]
  } | null
  flow_suggestion?: {
    id: string
    name: string
    action: "trigger" | "resume"
  } | null
  error?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Rate limit: 30 req/min per user
    const limit = await checkRateLimitWithRedis(`ai_reply:${user.id}`, RATE_LIMITS.ai_reply)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json().catch(() => null)
    if (!body?.conversation_id) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
    }

    const conversationId: string = body.conversation_id
    const agentText: string = body.agent_text?.trim() ?? ""

    // Fetch conversation + contact, verify ownership
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("*, contact:contacts(*)")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single()
    if (convError || !conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    const contact = conversation.contact as { id: string; name?: string; phone?: string } | undefined
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 })
    }

    // Fetch last 10 messages
    const { data: messages } = await supabase
      .from("messages")
      .select("sender_type, content_text, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10)
    const recentMessages = ((messages ?? []) as { sender_type: string; content_text: string | null; created_at: string }[])
      .reverse()
      .map((m) => ({
        role: m.sender_type === "customer" ? "customer" : "agent",
        text: m.content_text ?? "",
      }))

    // Fetch user's approved templates (name + category only)
    const { data: templates } = await supabase
      .from("message_templates")
      .select("id, name, category")
      .eq("user_id", user.id)
      .filter("status", "eq", "approved")
      .limit(30)
    const templateList = ((templates ?? []) as { id: string; name: string; category: string }[]).map((t) => ({
      name: t.name,
      category: t.category,
    }))

    // Fetch user's active flows (name + trigger_type only)
    const { data: flows } = await supabase
      .from("flows")
      .select("id, name, trigger_type")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(10)
    const flowList = ((flows ?? []) as { id: string; name: string; trigger_type: string }[])

    // Check if contact has an active flow run
    const { data: activeRun } = await supabase
      .from("flow_runs")
      .select("id, flow_id")
      .eq("contact_id", contact.id)
      .eq("status", "active")
      .maybeSingle()
    let activeFlowName: string | undefined
    if (activeRun) {
      const { data: flow } = await supabase
        .from("flows")
        .select("name")
        .eq("id", activeRun.flow_id)
        .single()
      activeFlowName = (flow as { name: string } | null)?.name
    }

    // Build prompt and call AI with JSON response format [R2]
    const prompt = buildReplyPrompt({
      contactName: contact.name ?? "Unknown",
      contactPhone: contact.phone ?? "Unknown",
      agentName: user.email ?? "Agent",
      messages: recentMessages,
      agentText,
      templates: templateList,
      flows: flowList.map((f) => ({ name: f.name, trigger_type: f.trigger_type })),
      activeFlowName,
    })

    const response = await callAi(prompt, undefined, { type: "json_object" })

    const raw = response.choices?.[0]?.message?.content
    if (!raw) {
      return NextResponse.json({ suggestion: null, error: "AI returned empty response" } satisfies AiReplyResponse)
    }

    // Parse AI output with robust extraction [R5]
    const parsed = tryExtractJson(raw)
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ suggestion: null, error: "AI returned invalid JSON" } satisfies AiReplyResponse)
    }

    const result = parsed as Record<string, unknown>
    const type = result.type as string | undefined

    if (type === "template") {
      const name = result.name as string | undefined
      const params = Array.isArray(result.params) ? result.params as string[] : []

      if (!name) {
        return NextResponse.json({ suggestion: null, error: "AI returned template without name" } satisfies AiReplyResponse)
      }

      // [R3] Look up template by name to get its id and body_text
      const { data: tmpl } = await supabase
        .from("message_templates")
        .select("id")
        .eq("user_id", user.id)
        .filter("name", "eq", name)
        .maybeSingle()

      if (!tmpl) {
        return NextResponse.json({
          suggestion: null,
          template_recommendation: { id: "", name, params },
          error: `Template "${name}" not found`,
        } satisfies AiReplyResponse)
      }

      return NextResponse.json({
        suggestion: null,
        template_recommendation: { id: (tmpl as { id: string }).id, name, params },
        flow_suggestion: null,
      } satisfies AiReplyResponse)
    }

    if (type === "flow") {
      const name = result.name as string | undefined
      const action = result.action as string | undefined

      if (!name) {
        return NextResponse.json({ suggestion: null, error: "AI returned flow without name" } satisfies AiReplyResponse)
      }

      const flow = flowList.find((f) => f.name.toLowerCase() === name.toLowerCase())
      if (!flow) {
        return NextResponse.json({
          suggestion: null,
          flow_suggestion: { id: "", name, action: "trigger" as const },
          error: `Flow "${name}" not found`,
        } satisfies AiReplyResponse)
      }

      return NextResponse.json({
        suggestion: null,
        template_recommendation: null,
        flow_suggestion: { id: flow.id, name: flow.name, action: (action === "resume" ? "resume" : "trigger") as "trigger" | "resume" },
      } satisfies AiReplyResponse)
    }

    // type === "reply"
    const text = result.text as string | undefined
    return NextResponse.json({
      suggestion: text ?? null,
      template_recommendation: null,
      flow_suggestion: null,
    } satisfies AiReplyResponse)

  } catch (err) {
    console.error("[ai-reply] suggest error:", err)
    return NextResponse.json({
      suggestion: null,
      error: err instanceof Error ? err.message : "Internal error",
    } satisfies AiReplyResponse, { status: 500 })
  }
}
