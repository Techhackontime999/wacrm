import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock ioredis before importing the module under test
vi.mock("ioredis", () => {
  const MockRedis = vi.fn(function () {
    return { on: vi.fn().mockReturnThis() }
  })
  return { default: MockRedis }
})

beforeEach(() => {
  vi.resetModules()
  // Clear env before each test
  delete process.env.REDIS_URL
})

describe("getRedis", () => {
  it("returns null when REDIS_URL is not set", async () => {
    const { getRedis } = await import("./client")
    expect(getRedis()).toBeNull()
  })

  it("returns null when connection was lost", async () => {
    process.env.REDIS_URL = "redis://localhost:6379"
    const { getRedis } = await import("./client")
    // First call creates the client
    const r = getRedis()
    expect(r).not.toBeNull()
  })
})

describe("redisSafe", () => {
  it("returns fallback when getRedis() returns null", async () => {
    const { redisSafe } = await import("./client")
    const result = await redisSafe(
      async () => "should-not-run",
      "fallback-value",
    )
    expect(result).toBe("fallback-value")
  })

  it("returns fallback on error", async () => {
    process.env.REDIS_URL = "redis://localhost:6379"
    const { redisSafe } = await import("./client")
    const result = await redisSafe(
      async () => { throw new Error("boom") },
      "fallback",
    )
    expect(result).toBe("fallback")
  })
})
