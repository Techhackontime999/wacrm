import { describe, expect, it, vi } from "vitest"
import { callAi } from "./provider"
import type { AiMessage } from "./types"

describe("callAi", () => {
  const msgs: AiMessage[] = [{ role: "user", content: "hello" }]

  it("throws when AI_API_KEY is not set", async () => {
    const prev = process.env.AI_API_KEY
    delete process.env.AI_API_KEY
    delete process.env.OPENAI_API_KEY
    await expect(callAi(msgs)).rejects.toThrow(/AI_API_KEY/)
    process.env.AI_API_KEY = prev
  })

  it("passes response_format when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] })),
    )
    try {
      process.env.AI_API_KEY = "sk-test"
      await callAi(msgs, undefined, { type: "json_object" })

      const callArgs = fetchSpy.mock.calls[0]
      expect(callArgs).toBeDefined()
      const body = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>
      expect(body.response_format).toEqual({ type: "json_object" })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("omits response_format when not provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] })),
    )
    try {
      process.env.AI_API_KEY = "sk-test"
      await callAi(msgs)

      const callArgs = fetchSpy.mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>
      expect(body.response_format).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
