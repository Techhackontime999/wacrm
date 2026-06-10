import { redisSafe } from './client'

const PHONE_CACHE_TTL = 86_400 // 24 hours

export async function getCachedPhone(contactId: string): Promise<string | null> {
  return redisSafe(
    (r) => r.get(`wacrm:phone:${contactId}`),
    null,
  )
}

export async function setCachedPhone(contactId: string, phone: string): Promise<void> {
  await redisSafe(
    (r) => r.set(`wacrm:phone:${contactId}`, phone, 'EX', PHONE_CACHE_TTL),
    undefined,
  )
}

export async function invalidateCachedPhone(contactId: string): Promise<void> {
  await redisSafe(
    (r) => r.del(`wacrm:phone:${contactId}`),
    undefined,
  )
}
