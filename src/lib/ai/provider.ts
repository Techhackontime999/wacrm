import type { AiMessage, AiResponse } from "./types"

function getConfig() {
  const baseUrl = process.env.AI_API_BASE?.replace(/\/+$/, "") ?? "https://api.openai.com/v1"
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? ""
  const model = process.env.AI_MODEL ?? "gpt-4o-mini"
  return { baseUrl, apiKey, model }
}

export async function callAi(
  messages: AiMessage[],
  tools?: object[],
): Promise<AiResponse> {
  const { baseUrl, apiKey, model } = getConfig()

  if (!apiKey) {
    throw new Error(
      "AI_API_KEY or OPENAI_API_KEY environment variable is not set. " +
        "To use the AI-powered CRM assistant, set one of these variables. " +
        "You can use any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, etc.)."
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
