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

/** [R6] Wraps a Redis call with safe null/error handling.
 *  Every Redis operation MUST use this helper instead of calling
 *  redis.get/set/incr directly. The callback parameter is `r` to
 *  avoid shadowing the imported `Redis` type. */
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
