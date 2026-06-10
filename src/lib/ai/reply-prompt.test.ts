import { describe, expect, it } from "vitest"
import { buildReplyPrompt, tryExtractJson } from "./reply-prompt"

describe("buildReplyPrompt", () => {
  const base = {
    contactName: "Alice",
    contactPhone: "+1234567890",
    agentName: "Bob",
    messages: [{ role: "customer", text: "Hi" }],
    agentText: "",
    templates: [],
    flows: [],
  }

  it("returns system and user messages", () => {
    const result = buildReplyPrompt(base)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("system")
    expect(result[1].role).toBe("user")
  })

  it("includes contact info in system prompt", () => {
    const [system] = buildReplyPrompt(base)
    expect(system.content).toContain("Alice")
    expect(system.content).toContain("+1234567890")
  })

  it("includes template names when provided", () => {
    const [system] = buildReplyPrompt({
      ...base,
      templates: [{ name: "greeting", category: "MARKETING" }],
    })
    expect(system.content).toContain("greeting")
    expect(system.content).toContain("MARKETING")
  })

  it("includes flow names when provided", () => {
    const [system] = buildReplyPrompt({
      ...base,
      flows: [{ name: "FAQ Bot", trigger_type: "keyword" }],
    })
    expect(system.content).toContain("FAQ Bot")
  })

  it("includes active flow run when provided", () => {
    const [system] = buildReplyPrompt({
      ...base,
      activeFlowName: "Support Flow",
    })
    expect(system.content).toContain("Support Flow")
  })
})

describe("tryExtractJson", () => {
  it("parses plain JSON", () => {
    expect(tryExtractJson('{"type":"reply","text":"hello"}')).toEqual({ type: "reply", text: "hello" })
  })

  it("strips markdown code fences", () => {
    const raw = "```json\n{\"type\":\"reply\",\"text\":\"hello\"}\n```"
    expect(tryExtractJson(raw)).toEqual({ type: "reply", text: "hello" })
  })

  it("strips code fences without language tag", () => {
    const raw = "```\n{\"type\":\"reply\",\"text\":\"hello\"}\n```"
    expect(tryExtractJson(raw)).toEqual({ type: "reply", text: "hello" })
  })

  it("returns null for invalid JSON", () => {
    expect(tryExtractJson("not json")).toBeNull()
  })
})
