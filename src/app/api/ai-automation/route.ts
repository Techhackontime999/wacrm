import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getTemplate } from '@/lib/automations/templates'
import {
  replaceSteps,
  insertSteps,
  loadStepsTree,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'
import { loadMetrics, loadConversationsSeries, loadPipelineDonut, loadResponseTime, loadActivity } from '@/lib/dashboard/queries'
import { callAi } from '@/lib/ai/provider'
import { CRM_TOOLS } from '@/lib/ai/tools'
import type { AiMessage } from '@/lib/ai/types'
import type {
  Automation,
  AutomationTriggerType,
  AutomationLog,
  Contact,
  Conversation,
  Broadcast,
  Pipeline,
  Deal,
  Tag,
  MessageTemplate,
} from '@/types'

const db = () => supabaseAdmin()

// ─── HELPERS ───────────────────────────────────────────────

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function extractNumber(text: string): number | null {
  const m = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/)
  return m ? parseFloat(m[0].replace(/,/g, '')) : null
}

function extractQuoted(text: string): string[] {
  return [...text.matchAll(/[""](.+?)[""]/g)].map((m) => m[1])
}

const TRIGGER_LABELS: Record<string, AutomationTriggerType> = {
  'new message': 'new_message_received',
  'first message': 'first_inbound_message',
  keyword: 'keyword_match',
  'new contact': 'new_contact_created',
  assigned: 'conversation_assigned',
  tag: 'tag_added',
  time: 'time_based',
  schedule: 'time_based',
}

const STEP_LABELS: Record<string, string> = {
  'send message': 'send_message',
  'send text': 'send_message',
  message: 'send_message',
  'send template': 'send_template',
  template: 'send_template',
  'add tag': 'add_tag',
  'remove tag': 'remove_tag',
  assign: 'assign_conversation',
  'update field': 'update_contact_field',
  'create deal': 'create_deal',
  deal: 'create_deal',
  wait: 'wait',
  delay: 'wait',
  condition: 'condition',
  'if else': 'condition',
  'send webhook': 'send_webhook',
  webhook: 'send_webhook',
  close: 'close_conversation',
}

function formatTriggerLabel(type: string): string {
  const labels: Record<string, string> = {
    new_message_received: 'New Message', first_inbound_message: 'First Message',
    keyword_match: 'Keyword Match', new_contact_created: 'New Contact',
    conversation_assigned: 'Assigned', tag_added: 'Tag Added', time_based: 'Time-Based',
  }
  return labels[type] ?? type
}

function formatDealStatus(s?: string): string {
  if (s === 'won') return 'Won'
  if (s === 'lost') return 'Lost'
  return 'Open'
}

function formatConversationStatus(s: string): string {
  if (s === 'open') return 'Open'
  if (s === 'pending') return 'Pending'
  if (s === 'closed') return 'Closed'
  return s
}

function formatBroadcastStatus(s: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending',
    sent: 'Sent', failed: 'Failed',
  }
  return labels[s] ?? s
}

// ─── FUZZY FIND ────────────────────────────────────────────

async function findAutomation(userId: string, query: string): Promise<Automation | null> {
  const { data } = await db()
    .from('automations')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${query}%`)
    .maybeSingle()
  return data as Automation | null
}

async function findContact(userId: string, query: string): Promise<Contact | null> {
  const lower = query.toLowerCase()
  const { data } = await db()
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .maybeSingle()
  if (data) return data as Contact
  const { data: all } = await db()
    .from('contacts').select('*').eq('user_id', userId)
  const contacts = (all ?? []) as Contact[]
  return contacts.find((c) => c.name?.toLowerCase().includes(lower) || c.phone?.includes(query)) ?? null
}

async function findConversation(userId: string, query: string): Promise<Conversation | null> {
  const contact = await findContact(userId, query)
  if (!contact) return null
  const { data } = await db()
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('user_id', userId)
    .eq('contact_id', contact.id)
    .maybeSingle()
  return data as Conversation | null
}

async function findDeal(userId: string, query: string): Promise<Deal | null> {
  const lower = query.toLowerCase()
  const { data } = await db()
    .from('deals').select('*').eq('user_id', userId).ilike('title', `%${query}%`)
    .maybeSingle()
  if (data) return data as Deal
  const { data: all } = await db()
    .from('deals').select('*').eq('user_id', userId)
  return ((all ?? []) as Deal[]).find((d) => d.title.toLowerCase().includes(lower)) ?? null
}

async function findPipeline(userId: string, query: string): Promise<Pipeline | null> {
  const lower = query.toLowerCase()
  const { data } = await db()
    .from('pipelines').select('*').eq('user_id', userId).ilike('name', `%${query}%`)
    .maybeSingle()
  if (data) return data as Pipeline
  const { data: all } = await db()
    .from('pipelines').select('*').eq('user_id', userId)
  return ((all ?? []) as Pipeline[]).find((p) => p.name.toLowerCase().includes(lower)) ?? null
}

async function findTag(userId: string, query: string): Promise<Tag | null> {
  const lower = query.toLowerCase()
  const { data } = await db()
    .from('tags').select('*').eq('user_id', userId).ilike('name', `%${query}%`)
    .maybeSingle()
  if (data) return data as Tag
  const { data: all } = await db()
    .from('tags').select('*').eq('user_id', userId)
  return ((all ?? []) as Tag[]).find((t) => t.name.toLowerCase().includes(lower)) ?? null
}

// ─── INTENT PARSING ────────────────────────────────────────

interface ParsedIntent {
  intent: string
  target?: string
  params: string[]
}

const intentPatterns: { regex: RegExp; intent: string; group?: number }[] = [
  { regex: /show\s+(me\s+)?(my\s+)?automations/i, intent: 'list_automations' },
  { regex: /list\s+(all\s+)?automations/i, intent: 'list_automations' },
  { regex: /what\s+automations/i, intent: 'list_automations' },
  { regex: /show\s+(me\s+)?(the\s+)?automation\s+[""](.+?)[""]/, intent: 'get_automation', group: 3 },
  { regex: /show\s+(me\s+)?automation\s+(.+)/, intent: 'get_automation', group: 2 },
  { regex: /get\s+automation\s+(.+)/, intent: 'get_automation', group: 1 },
  { regex: /details?\s+(for\s+)?automation\s+(.+)/, intent: 'get_automation', group: 2 },
  { regex: /create\s+(a\s+)?(new\s+)?welcome/i, intent: 'create_welcome' },
  { regex: /create\s+(a\s+)?(new\s+)?out\s+of\s+office/i, intent: 'create_ooo' },
  { regex: /ooo/i, intent: 'create_ooo' },
  { regex: /lead\s+qualifier/i, intent: 'create_lead' },
  { regex: /follow\s+up/i, intent: 'create_followup' },
  { regex: /create\s+(a\s+)?(new\s+)?automation/i, intent: 'create_automation' },
  { regex: /edit\s+automation\s+(.+)/, intent: 'edit_automation', group: 1 },
  { regex: /rename\s+automation\s+(.+?)(?:\s+to\s+|$)/, intent: 'rename_automation', group: 1 },
  { regex: /delete\s+automation\s+(.+)/, intent: 'delete_automation', group: 1 },
  { regex: /remove\s+automation\s+(.+)/, intent: 'delete_automation', group: 1 },
  { regex: /duplicate\s+automation\s+(.+)/, intent: 'duplicate_automation', group: 1 },
  { regex: /copy\s+automation\s+(.+)/, intent: 'duplicate_automation', group: 1 },
  { regex: /(?:activate|enable|turn\s+on)\s+automation\s+(.+)/, intent: 'activate_automation', group: 1 },
  { regex: /(?:deactivate|disable|pause|turn\s+off)\s+automation\s+(.+)/, intent: 'deactivate_automation', group: 1 },
  { regex: /activate\s+(all\s+)?(automations)?$/i, intent: 'activate_all' },
  { regex: /(?:deactivate|disable|pause)\s+(all\s+)?(automations)?$/i, intent: 'deactivate_all' },
  { regex: /turn\s+on\s+(all\s+)?(automations)?$/i, intent: 'activate_all' },
  { regex: /turn\s+off\s+(all\s+)?(automations)?$/i, intent: 'deactivate_all' },
  { regex: /logs?\s+(for\s+)?automation\s+(.+)/, intent: 'logs_automation', group: 2 },
  { regex: /show\s+(me\s+)?(my\s+)?contacts/i, intent: 'list_contacts' },
  { regex: /list\s+(my\s+)?contacts/i, intent: 'list_contacts' },
  { regex: /find\s+contact\s+(.+)/, intent: 'get_contact', group: 1 },
  { regex: /search\s+(for\s+)?contact\s+(.+)/, intent: 'get_contact', group: 2 },
  { regex: /show\s+contact\s+(.+)/, intent: 'get_contact', group: 1 },
  { regex: /create\s+(a\s+)?(new\s+)?contact/i, intent: 'create_contact' },
  { regex: /add\s+(a\s+)?(new\s+)?contact/i, intent: 'create_contact' },
  { regex: /update\s+contact\s+(.+?)(?:\s+(?:with|to|set|change))/, intent: 'update_contact', group: 1 },
  { regex: /edit\s+contact\s+(.+?)(?:\s+(?:with|to|set|change))/, intent: 'update_contact', group: 1 },
  { regex: /delete\s+contact\s+(.+)/, intent: 'delete_contact', group: 1 },
  { regex: /remove\s+contact\s+(.+)/, intent: 'delete_contact', group: 1 },
  { regex: /add\s+tag\s+(.+?)\s+to\s+contact\s+(.+)/, intent: 'tag_contact', group: 2 },
  { regex: /tag\s+contact\s+(.+?)\s+with\s+(.+)/, intent: 'tag_contact', group: 1 },
  { regex: /remove\s+tag\s+(.+?)\s+from\s+contact\s+(.+)/, intent: 'untag_contact', group: 2 },
  { regex: /show\s+(me\s+)?(my\s+)?(open\s+)?conversations/i, intent: 'list_conversations' },
  { regex: /list\s+(my\s+)?(open\s+)?conversations/i, intent: 'list_conversations' },
  { regex: /show\s+conversation\s+(?:with\s+)?(.+)/, intent: 'get_conversation', group: 1 },
  { regex: /send\s+(?:a\s+)?message\s+(?:to\s+)?(.+?)(?:\s+saying|\s+that\s+says|\s+with\s+text)/i, intent: 'send_message', group: 1 },
  { regex: /message\s+(.+?)(?:\s+saying|\s+that\s+says)/i, intent: 'send_message', group: 1 },
  { regex: /close\s+conversation\s+(?:with\s+)?(.+)/, intent: 'close_conversation', group: 1 },
  { regex: /(?:reopen|open)\s+conversation\s+(?:with\s+)?(.+)/, intent: 'reopen_conversation', group: 1 },
  { regex: /assign\s+conversation\s+(?:with\s+)?(.+?)(?:\s+to\s+|$)/, intent: 'assign_conversation', group: 1 },
  { regex: /show\s+(me\s+)?(my\s+)?broadcasts/i, intent: 'list_broadcasts' },
  { regex: /list\s+(my\s+)?broadcasts/i, intent: 'list_broadcasts' },
  { regex: /create\s+(a\s+)?(new\s+)?broadcast/i, intent: 'create_broadcast' },
  { regex: /show\s+(me\s+)?(my\s+)?pipelines/i, intent: 'list_pipelines' },
  { regex: /list\s+(my\s+)?pipelines/i, intent: 'list_pipelines' },
  { regex: /show\s+(me\s+)?(my\s+)?deals/i, intent: 'list_deals' },
  { regex: /list\s+(my\s+)?deals/i, intent: 'list_deals' },
  { regex: /create\s+(a\s+)?(new\s+)?deal/i, intent: 'create_deal' },
  { regex: /move\s+deal\s+(.+?)(?:\s+to\s+|$)/, intent: 'move_deal', group: 1 },
  { regex: /mark\s+deal\s+(.+?)\s+as\s+(won|lost)/i, intent: 'status_deal', group: 1 },
  { regex: /show\s+(me\s+)?(my\s+)?tags/i, intent: 'list_tags' },
  { regex: /list\s+(my\s+)?tags/i, intent: 'list_tags' },
  { regex: /create\s+(a\s+)?(new\s+)?tag/i, intent: 'create_tag' },
  { regex: /show\s+(me\s+)?(?:the\s+)?dashboard/i, intent: 'dashboard' },
  { regex: /(?:get|show)\s+(?:my\s+)?stats/i, intent: 'dashboard' },
  { regex: /summary/i, intent: 'dashboard' },
  { regex: /how\s+(?:are\s+)?things/i, intent: 'dashboard' },
  { regex: /(?:is\s+)?whatsapp\s+(?:connected|status|config)/i, intent: 'whatsapp_status' },
  { regex: /check\s+(?:my\s+)?whatsapp/i, intent: 'whatsapp_status' },
  { regex: /show\s+(me\s+)?(?:my\s+)?(?:message\s+)?templates/i, intent: 'list_templates' },
  { regex: /list\s+(?:my\s+)?templates/i, intent: 'list_templates' },
  { regex: /help/i, intent: 'help' },
  { regex: /what\s+can\s+you\s+do/i, intent: 'help' },
  { regex: /commands?/i, intent: 'help' },
  { regex: /guide/i, intent: 'help' },
]

function parseIntent(message: string): ParsedIntent {
  for (const { regex, intent, group } of intentPatterns) {
    const m = message.match(regex)
    if (m) {
      const target = group ? m[group]?.trim() : undefined
      return { intent, target, params: extractQuoted(message) }
    }
  }
  return { intent: 'unknown', params: [] }
}

// ─── AI-POWERED INTENT RESOLUTION ──────────────────────────

const SYSTEM_PROMPT = `You are a CRM assistant for wacrm, a WhatsApp business CRM. The user manages automations, contacts, conversations, deals, broadcasts, tags, message templates, and their WhatsApp connection.

Given the user's message, pick the most specific CRM action from the available tools and extract all relevant parameters.

Rules:
- If the user is just chatting, greeting, thanking, or asking a general question, use the "reply" tool with a friendly response.
- For CRM actions, pass clearly identified parameters. If a parameter (like a name) appears without quotes, extract it naturally.
- The "create_automation_from_template" template field accepts: welcome_message, out_of_office, lead_qualifier, follow_up_reminder.
- For "get_contact", "send_message", "close_conversation", "reopen_conversation" — use the contact's name or phone number.
- For automation actions, use the automation name as the identifier.
- Current date: {date}`

const TOOL_TO_INTENT: Record<string, string> = {
  list_automations: 'list_automations',
  get_automation: 'get_automation',
  create_automation_from_template: 'create_welcome',
  create_automation: 'create_automation',
  delete_automation: 'delete_automation',
  duplicate_automation: 'duplicate_automation',
  activate_automation: 'activate_automation',
  deactivate_automation: 'deactivate_automation',
  activate_all_automations: 'activate_all',
  deactivate_all_automations: 'deactivate_all',
  rename_automation: 'rename_automation',
  get_automation_logs: 'logs_automation',
  list_contacts: 'list_contacts',
  get_contact: 'get_contact',
  create_contact: 'create_contact',
  update_contact: 'update_contact',
  delete_contact: 'delete_contact',
  tag_contact: 'tag_contact',
  untag_contact: 'untag_contact',
  list_conversations: 'list_conversations',
  get_conversation: 'get_conversation',
  send_message: 'send_message',
  close_conversation: 'close_conversation',
  reopen_conversation: 'reopen_conversation',
  list_deals: 'list_deals',
  create_deal: 'create_deal',
  move_deal: 'move_deal',
  mark_deal_won: 'status_deal',
  mark_deal_lost: 'status_deal',
  list_pipelines: 'list_pipelines',
  list_broadcasts: 'list_broadcasts',
  create_broadcast: 'create_broadcast',
  list_tags: 'list_tags',
  create_tag: 'create_tag',
  list_templates: 'list_templates',
  get_dashboard: 'dashboard',
  get_whatsapp_status: 'whatsapp_status',
}

function extractFirstParam(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

async function resolveIntent(message: string): Promise<{ parsed: ParsedIntent; replyOverride?: string }> {
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    const parsed = parseIntent(message)
    return { parsed }
  }

  try {
    const systemPrompt = SYSTEM_PROMPT.replace('{date}', new Date().toLocaleDateString())
    const response = await callAi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      CRM_TOOLS as unknown as object[],
    )

    const choice = response.choices[0]
    const toolCall = choice.message?.tool_calls?.[0]

    if (!toolCall) {
      const text = choice.message?.content
      if (text) return { parsed: { intent: 'ai_reply', params: [] }, replyOverride: text }
      return { parsed: parseIntent(message) }
    }

    const toolName = toolCall.function.name
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>

    if (toolName === 'reply') {
      return { parsed: { intent: 'ai_reply', params: [] }, replyOverride: (args.text as string) ?? '' }
    }

    const intent = TOOL_TO_INTENT[toolName] ?? 'unknown'

    if (intent === 'create_welcome') {
      const templateArg = args.template as string
      if (templateArg === 'out_of_office') return { parsed: { intent: 'create_ooo', params: [] } }
      if (templateArg === 'lead_qualifier') return { parsed: { intent: 'create_lead', params: [] } }
      if (templateArg === 'follow_up_reminder') return { parsed: { intent: 'create_followup', params: [] } }
    }

    const target = extractFirstParam(args, 'name', 'name_or_phone', 'contact', 'title')

    return { parsed: { intent, target, params: [] } }
  } catch (err) {
    console.error('AI intent resolution failed, falling back to regex:', err)
    const parsed = parseIntent(message)
    return { parsed }
  }
}

// ─── HANDLERS ──────────────────────────────────────────────

// ── Automations ──

async function handleListAutomations(userId: string) {
  const { data } = await db()
    .from('automations')
    .select('id, name, trigger_type, is_active, execution_count, last_executed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data ?? []) as Automation[]
}

async function handleGetAutomation(userId: string, target: string) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  const steps = await loadStepsTree(a.id)
  return { automation: a, steps }
}

const TEMPLATE_SLUGS: Record<string, string> = {
  create_welcome: 'welcome_message',
  create_ooo: 'out_of_office',
  create_lead: 'lead_qualifier',
  create_followup: 'follow_up_reminder',
}

async function handleCreateTemplate(userId: string, slug: string) {
  const t = getTemplate(slug)
  if (!t) return null
  const { data: automation } = await db()
    .from('automations')
    .insert({ user_id: userId, name: t.name, description: t.description, trigger_type: t.trigger_type, trigger_config: t.trigger_config as Record<string, unknown>, is_active: true })
    .select().single()
  if (automation && t.steps.length > 0) {
    await insertSteps(automation.id, t.steps.map((s) => ({ step_type: s.step_type, step_config: s.step_config as Record<string, unknown> })) as BuilderStepInput[])
  }
  return automation as Automation | null
}

async function handleCreateAutomation(userId: string, message: string) {
  const triggerType: AutomationTriggerType = Object.entries(TRIGGER_LABELS).find(([k]) => message.toLowerCase().includes(k))?.[1] ?? 'new_message_received'
  const quoted = extractQuoted(message)
  const name = quoted[0] ?? `Automation ${new Date().toLocaleDateString()}`
  const { data: automation } = await db()
    .from('automations')
    .insert({ user_id: userId, name, description: 'Created via AI chat', trigger_type: triggerType, trigger_config: triggerType === 'keyword_match' ? { keywords: ['hello'], match_type: 'contains' } : {}, is_active: false })
    .select().single()
  if (automation) {
    const steps: BuilderStepInput[] = [{ step_type: 'send_message', step_config: { text: 'Thanks for reaching out!' } }]
    await insertSteps(automation.id, steps)
  }
  return automation as Automation | null
}

async function handleDeleteAutomation(userId: string, target: string) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  await db().from('automations').delete().eq('id', a.id)
  return a
}

async function handleDuplicateAutomation(userId: string, target: string) {
  const original = await findAutomation(userId, target)
  if (!original) return null
  const { data: copy } = await db()
    .from('automations')
    .insert({ user_id: userId, name: `${original.name} (Copy)`, description: original.description, trigger_type: original.trigger_type, trigger_config: original.trigger_config as Record<string, unknown>, is_active: false })
    .select().single()
  if (copy) {
    const steps = await loadStepsTree(original.id)
    if (steps.length > 0) await insertSteps(copy.id, steps.map((s) => ({ step_type: s.step_type, step_config: s.step_config, branches: s.branches })) as BuilderStepInput[])
  }
  return copy as Automation | null
}

async function handleToggleAutomation(userId: string, target: string, active: boolean) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  if (active) {
    const steps = await loadStepsTree(a.id)
    const issues = [...validateTriggerForActivation(a.trigger_type, a.trigger_config), ...validateStepsForActivation(steps)]
    if (issues.length > 0) return { automation: a, issues }
  }
  await db().from('automations').update({ is_active: active }).eq('id', a.id)
  return { automation: { ...a, is_active: active }, issues: [] }
}

async function handleToggleAll(userId: string, active: boolean) {
  if (active) {
    const { data: list } = await db().from('automations').select('id, trigger_type, trigger_config').eq('user_id', userId).eq('is_active', false)
    if (list) {
      for (const a of list) {
        const steps = await loadStepsTree(a.id)
        const issues = [...validateTriggerForActivation(a.trigger_type, a.trigger_config as Record<string, unknown>), ...validateStepsForActivation(steps)]
        if (issues.length > 0) continue
        await db().from('automations').update({ is_active: true }).eq('id', a.id)
      }
    }
  } else {
    await db().from('automations').update({ is_active: false }).eq('user_id', userId).eq('is_active', true)
  }
  return true
}

async function handleEditAutomation(userId: string, target: string, message: string) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  const update: Record<string, unknown> = {}
  const nameMatch = message.match(/(?:rename|name)\s+(?:to\s+)?[""](.+?)[""]/i)
  if (nameMatch) update.name = nameMatch[1]
  const triggerType = Object.entries(TRIGGER_LABELS).find(([k]) => message.toLowerCase().includes(k))?.[1]
  if (triggerType) {
    update.trigger_type = triggerType
    update.trigger_config = triggerType === 'keyword_match' ? { keywords: ['hello'], match_type: 'contains' } : {}
  }
  if (Object.keys(update).length > 0) await db().from('automations').update(update).eq('id', a.id)
  return { ...a, ...update } as Automation
}

async function handleRenameAutomation(userId: string, target: string, message: string) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  const m = message.match(/(?:to\s+)?[""](.+?)[""]/i)
  if (!m) return null
  await db().from('automations').update({ name: m[1] }).eq('id', a.id)
  return { ...a, name: m[1] } as Automation
}

async function handleLogsAutomation(userId: string, target: string) {
  const a = await findAutomation(userId, target)
  if (!a) return null
  const { data } = await db()
    .from('automation_logs')
    .select('id, status, trigger_event, steps_executed, error_message, created_at')
    .eq('automation_id', a.id)
    .order('created_at', { ascending: false })
    .limit(20)
  return { automation: a, logs: (data ?? []) as AutomationLog[] }
}

// ── Contacts ──

async function handleListContacts(userId: string) {
  const { data } = await db()
    .from('contacts').select('id, name, phone, email, company, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  return (data ?? []) as Contact[]
}

async function handleGetContact(userId: string, target: string) {
  return findContact(userId, target)
}

async function handleCreateContact(userId: string, message: string) {
  const quoted = extractQuoted(message)
  const name = quoted[0] ?? null
  const phoneMatch = message.match(/(?:phone|number|tel)[:\s]*\+?(\d[\d\s-]{6,})\d/i)
  const emailMatch = message.match(/(?:email)[:\s]*[""]?([\w@.-]+)[""]?/i)
  const companyMatch = message.match(/(?:company)[:\s]*[""]?([\w\s]+)[""]?/i)
  const phone = phoneMatch ? phoneMatch[1].replace(/[\s-]/g, '') : null
  if (!name || !phone) return null
  const { data } = await db()
    .from('contacts')
    .insert({ user_id: userId, name, phone, email: emailMatch?.[1] ?? null, company: companyMatch?.[1] ?? null })
    .select().single()
  return data as Contact | null
}

async function handleUpdateContact(userId: string, target: string, message: string) {
  const c = await findContact(userId, target)
  if (!c) return null
  const update: Record<string, string | null> = {}
  const emailMatch = message.match(/(?:email)[:\s]*[""]?([\w@.-]+)[""]?/i)
  const companyMatch = message.match(/(?:company)[:\s]*[""]?([\w\s]+)[""]?/i)
  const nameMatch = message.match(/(?:name|rename)[:\s]*[""]?(.+?)[""]?$/i)
  const phoneMatch = message.match(/(?:phone|number)[:\s]*\+?(\d[\d\s-]{6,})\d/i)
  if (emailMatch) update.email = emailMatch[1]
  if (companyMatch) update.company = companyMatch[1].trim()
  if (nameMatch && !message.toLowerCase().includes('update contact')) update.name = nameMatch[1].trim()
  if (phoneMatch) update.phone = phoneMatch[1].replace(/[\s-]/g, '')
  if (Object.keys(update).length === 0) return null
  await db().from('contacts').update(update).eq('id', c.id)
  return { ...c, ...update } as Contact
}

async function handleDeleteContact(userId: string, target: string) {
  const c = await findContact(userId, target)
  if (!c) return null
  await db().from('contacts').delete().eq('id', c.id)
  return c
}

async function handleTagContact(userId: string, target: string, message: string) {
  const c = await findContact(userId, target)
  if (!c) return null
  const m = message.match(/(?:with|tag)\s+[""]?(.+?)[""]?$/i)
  const tagName = m?.[1]?.trim() ?? extractQuoted(message).slice(-1)[0]
  if (!tagName) return null
  let tag = await findTag(userId, tagName)
  if (!tag) {
    const { data } = await db()
      .from('tags').insert({ user_id: userId, name: tagName, color: '#6366f1' }).select().single()
    tag = data as Tag
  }
  if (tag) {
    await db().from('contact_tags').insert({ contact_id: c.id, tag_id: tag.id }).select().maybeSingle()
  }
  return { contact: c, tag }
}

async function handleUntagContact(userId: string, target: string, message: string) {
  const c = await findContact(userId, target)
  if (!c) return null
  const m = message.match(/(?:tag|from)\s+[""]?(.+?)[""]?$/i)
  const tagName = m?.[1]?.trim()
  if (!tagName) return null
  const tag = await findTag(userId, tagName)
  if (tag) await db().from('contact_tags').delete().eq('contact_id', c.id).eq('tag_id', tag.id)
  return { contact: c, tag }
}

// ── Conversations ──

async function handleListConversations(userId: string) {
  const { data } = await db()
    .from('conversations')
    .select('id, status, unread_count, last_message_text, last_message_at, contact:contacts(name, phone)')
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(30)
  return data ?? []
}

async function handleGetConversation(userId: string, target: string) {
  const conv = await findConversation(userId, target)
  if (!conv) return null
  const { data: messages } = await db()
    .from('messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: true }).limit(30)
  return { conversation: conv, messages: messages ?? [] }
}

async function handleSendMessage(userId: string, target: string, message: string) {
  const conv = await findConversation(userId, target)
  if (!conv) return null
  const textMatch = message.match(/(?:saying|says|text)\s+[""](.+?)[""]/i)
  const text = textMatch?.[1] ?? extractQuoted(message).slice(-1)[0]
  if (!text) return null
  const { data: msg } = await db()
    .from('messages')
    .insert({ conversation_id: conv.id, sender_type: 'bot', content_type: 'text', content_text: text, status: 'sent' })
    .select().single()
  await db().from('conversations').update({ last_message_text: text, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', conv.id)
  return { conversation: conv, message: msg }
}

async function handleCloseConversation(userId: string, target: string) {
  const conv = await findConversation(userId, target)
  if (!conv) return null
  await db().from('conversations').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', conv.id)
  return { ...conv, status: 'closed' } as Conversation
}

async function handleReopenConversation(userId: string, target: string) {
  const conv = await findConversation(userId, target)
  if (!conv) return null
  await db().from('conversations').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', conv.id)
  return { ...conv, status: 'open' } as Conversation
}

async function handleAssignConversation(userId: string, target: string, message: string) {
  const conv = await findConversation(userId, target)
  if (!conv) return null
  const agentMatch = message.match(/(?:to|agent)\s+[""]?(.+?)[""]?$/i)
  // Simplified: just log it; real assignment would need profile lookup
  return { conversation: conv, assigned_to: agentMatch?.[1] ?? 'requested' }
}

// ── Broadcasts ──

async function handleListBroadcasts(userId: string) {
  const { data } = await db()
    .from('broadcasts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
  return (data ?? []) as Broadcast[]
}

async function handleCreateBroadcast(userId: string, message: string) {
  const quoted = extractQuoted(message)
  const name = quoted[0] ?? `Broadcast ${new Date().toLocaleDateString()}`
  const templateName = quoted[1] ?? null
  if (!templateName) return { broadcast: null, reason: 'template_name' }
  const { data } = await db()
    .from('broadcasts')
    .insert({ user_id: userId, name, template_name: templateName, template_language: 'en_US', status: 'draft', total_recipients: 0 })
    .select().single()
  return { broadcast: data as Broadcast | null, reason: null }
}

// ── Pipelines & Deals ──

async function handleListPipelines(userId: string) {
  const { data } = await db()
    .from('pipelines').select('*').eq('user_id', userId).order('created_at')
  return (data ?? []) as Pipeline[]
}

async function handleListDeals(userId: string) {
  const { data } = await db()
    .from('deals').select('*, pipeline:pipelines(name), stage:pipeline_stages(name)').eq('user_id', userId).order('created_at', { ascending: false })
  return (data ?? []) as (Deal & { pipeline?: { name: string }; stage?: { name: string } })[]
}

async function handleCreateDeal(userId: string, message: string) {
  const quoted = extractQuoted(message)
  const title = quoted[0] ?? 'Untitled Deal'
  const pipeline = quoted[1] ? await findPipeline(userId, quoted[1]) : null
  const value = extractNumber(message) ?? 0
  if (!pipeline) return null
  const { data: stages } = await db()
    .from('pipeline_stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1)
  const stageId = stages?.[0]?.id
  if (!stageId) return null
  const { data } = await db()
    .from('deals').insert({ user_id: userId, pipeline_id: pipeline.id, stage_id: stageId, title, value }).select().single()
  return data as Deal | null
}

async function handleMoveDeal(userId: string, target: string, message: string) {
  const deal = await findDeal(userId, target)
  if (!deal) return null
  const stageMatch = message.match(/(?:to|into)\s+[""](.+?)[""]/i)
  const stageName = stageMatch?.[1] ?? extractQuoted(message).slice(-1)[0]
  if (!stageName) return { deal, moved: false }
  const { data: stages } = await db()
    .from('pipeline_stages').select('id, name, position').eq('pipeline_id', deal.pipeline_id).order('position')
  const stage = ((stages ?? []) as { id: string; name: string; position: number }[]).find(
    (s) => s.name.toLowerCase().includes(stageName.toLowerCase()),
  )
  if (!stage) return { deal, moved: false }
  await db().from('deals').update({ stage_id: stage.id }).eq('id', deal.id)
  return { ...deal, stage_id: stage.id } as Deal
}

async function handleStatusDeal(userId: string, target: string, message: string) {
  const deal = await findDeal(userId, target)
  if (!deal) return null
  const status = message.toLowerCase().includes('won') ? 'won' : (message.toLowerCase().includes('lost') ? 'lost' : null)
  if (!status) return null
  await db().from('deals').update({ status }).eq('id', deal.id)
  return { ...deal, status } as Deal
}

// ── Tags ──

async function handleListTags(userId: string) {
  const { data } = await db()
    .from('tags').select('id, name, color, created_at').eq('user_id', userId).order('name')
  return (data ?? []) as Tag[]
}

async function handleCreateTag(userId: string, message: string) {
  const quoted = extractQuoted(message)
  const name = quoted[0] ?? null
  if (!name) return null
  const colorMatch = message.match(/(?:color)[:\s]*#?([\w]{3,8})/i)
  const { data } = await db()
    .from('tags').insert({ user_id: userId, name, color: colorMatch ? `#${colorMatch[1]}` : '#6366f1' }).select().single()
  return data as Tag | null
}

// ── Templates ──

async function handleListTemplates(userId: string) {
  const { data } = await db()
    .from('message_templates').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
  return (data ?? []) as unknown as MessageTemplate[]
}

// ── Dashboard ──

async function handleDashboard(userId: string) {
  const client = createClient()
  const supabase = await client
  const metrics = await loadMetrics(supabase)
  return metrics
}

// ── WhatsApp ──

async function handleWhatsAppStatus(userId: string) {
  const { data } = await db()
    .from('whatsapp_config').select('status, phone_number_id, connected_at').eq('user_id', userId).maybeSingle()
  return data as { status: string; phone_number_id: string; connected_at: string } | null
}

// ─── MAIN HANDLER ───────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const message = String(body.message).trim()
  const { parsed, replyOverride } = await resolveIntent(message)
  let { intent, target, params } = parsed

  try {
    if (replyOverride) {
      return NextResponse.json({
        reply: replyOverride,
        action: { type: 'ai_reply', status: 'success' as const },
      })
    }

    switch (intent) {
      // ── Automations ──
      case 'list_automations': {
        const list = await handleListAutomations(user.id)
        if (list.length === 0) return NextResponse.json({
          reply: 'You have no automations yet. Try "create a welcome automation" or "create an automation called \\"Support\\"."',
          action: { type: 'list', status: 'success' as const, detail: '0 automations' },
        })
        const activeCount = list.filter((a) => a.is_active).length
        const lines = list.map((a, i) =>
          `${i + 1}. **${a.name}** — ${a.is_active ? 'Active' : 'Paused'} (${formatTriggerLabel(a.trigger_type)}, ${a.execution_count} runs)`,
        )
        return NextResponse.json({
          reply: `**${list.length}** automation(s) — ${activeCount} active, ${list.length - activeCount} paused.\n\n${lines.join('\n')}\n\nSay "show automation [name]" for details or "create" to add one.`,
          action: { type: 'list', status: 'success' as const, detail: `${list.length} automations` },
          automations: list.map((a) => ({ id: a.id, name: a.name, is_active: a.is_active })),
        })
      }

      case 'get_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation? Try "show automation [name]".' })
        const result = await handleGetAutomation(user.id, target)
        if (!result) return NextResponse.json({ reply: `No automation found matching "${target}".` })
        const { automation, steps } = result
        const stepList = steps.length === 0 ? '  (no steps)' : steps.map((s, i) => `  ${i + 1}. ${stepPreview(s)}`).join('\n')
        return NextResponse.json({
          reply: `**${automation.name}**\nTrigger: ${formatTriggerLabel(automation.trigger_type)} | ${automation.is_active ? 'Active' : 'Paused'}\nRuns: ${automation.execution_count} | Last: ${automation.last_executed_at ? new Date(automation.last_executed_at).toLocaleString() : 'Never'}\n\n**Steps:**\n${stepList}`,
          action: { type: 'details', status: 'success' as const, detail: automation.name },
        })
      }

      case 'create_welcome':
      case 'create_ooo':
      case 'create_lead':
      case 'create_followup': {
        const a = await handleCreateTemplate(user.id, TEMPLATE_SLUGS[intent])
        if (!a) return NextResponse.json({ reply: 'Failed to create automation.' })
        return NextResponse.json({
          reply: `Created and activated **${a.name}**! Trigger: ${formatTriggerLabel(a.trigger_type)}. It is now live.\n\nSay "show automation ${a.name}" to see details.`,
          action: { type: 'created', status: 'success' as const, detail: a.name },
        })
      }

      case 'create_automation': {
        const a = await handleCreateAutomation(user.id, message)
        if (!a) return NextResponse.json({ reply: 'Failed to create automation.' })
        return NextResponse.json({
          reply: `Created **${a.name}** (draft). Activate it with "activate automation ${a.name}" or edit in the builder.`,
          action: { type: 'created', status: 'success' as const, detail: a.name },
        })
      }

      case 'edit_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation to edit?' })
        const a = await handleEditAutomation(user.id, target, message)
        if (!a) return NextResponse.json({ reply: `No automation "${target}" found.` })
        return NextResponse.json({
          reply: `Updated **${a.name}**. Say "show automation ${a.name}" to review changes.`,
          action: { type: 'edited', status: 'success' as const, detail: a.name },
        })
      }

      case 'rename_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation to rename?' })
        const a = await handleRenameAutomation(user.id, target, message)
        if (!a) return NextResponse.json({ reply: 'Could not rename.' })
        return NextResponse.json({
          reply: `Renamed to **${a.name}**.`,
          action: { type: 'renamed', status: 'success' as const, detail: a.name },
        })
      }

      case 'delete_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation to delete?' })
        const a = await handleDeleteAutomation(user.id, target)
        if (!a) return NextResponse.json({ reply: `"${target}" not found.` })
        return NextResponse.json({
          reply: `Deleted **${a.name}** and its history.`,
          action: { type: 'deleted', status: 'success' as const, detail: a.name },
        })
      }

      case 'duplicate_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation to duplicate?' })
        const a = await handleDuplicateAutomation(user.id, target)
        if (!a) return NextResponse.json({ reply: `"${target}" not found.` })
        return NextResponse.json({
          reply: `Duplicated as **${a.name}** (draft). Activate with "activate automation ${a.name}".`,
          action: { type: 'duplicated', status: 'success' as const, detail: a.name },
        })
      }

      case 'activate_automation':
      case 'deactivate_automation': {
        const active = intent === 'activate_automation'
        if (!target) return NextResponse.json({ reply: `Which automation to ${active ? 'activate' : 'deactivate'}?` })
        const result = await handleToggleAutomation(user.id, target, active)
        if (!result) return NextResponse.json({ reply: `"${target}" not found.` })
        if ('issues' in result && result.issues.length > 0) {
          return NextResponse.json({
            reply: `Cannot activate **${result.automation.name}** — issues:\n${result.issues.map((i) => `- ${i.message}`).join('\n')}`,
            action: { type: 'validation_error', status: 'error' as const },
          })
        }
        return NextResponse.json({
          reply: `**${result.automation.name}** is now ${active ? 'active' : 'paused'}.`,
          action: { type: active ? 'activated' : 'deactivated', status: 'success' as const },
        })
      }

      case 'activate_all':
      case 'deactivate_all': {
        const active = intent === 'activate_all'
        await handleToggleAll(user.id, active)
        return NextResponse.json({
          reply: active ? 'All valid automations activated (invalid ones skipped).' : 'All automations paused.',
          action: { type: active ? 'activated_all' : 'deactivated_all', status: 'success' as const },
        })
      }

      case 'logs_automation': {
        if (!target) return NextResponse.json({ reply: 'Which automation\'s logs?' })
        const result = await handleLogsAutomation(user.id, target)
        if (!result) return NextResponse.json({ reply: `"${target}" not found.` })
        const { automation, logs } = result
        if (logs.length === 0) return NextResponse.json({
          reply: `**${automation.name}** has no logs yet. Automations generate logs when triggered.`,
          action: { type: 'logs', status: 'success' as const, detail: '0 logs' },
        })
        return NextResponse.json({
          reply: `**${automation.name}** — Last ${logs.length} log(s):\n${logs.map((l, i) => `  ${i + 1}. ${new Date(l.created_at).toLocaleString()} — ${l.status} (${l.trigger_event})${l.error_message ? ': ' + l.error_message : ''}`).join('\n')}`,
          action: { type: 'logs', status: 'success' as const, detail: `${logs.length} logs` },
        })
      }

      // ── Contacts ──
      case 'list_contacts': {
        const contacts = await handleListContacts(user.id)
        if (contacts.length === 0) return NextResponse.json({
          reply: 'No contacts yet. Contacts are auto-created when customers message you, or try "create contact \\"John\\" with phone 1234567890".',
          action: { type: 'list', status: 'success' as const, detail: '0 contacts' },
        })
        return NextResponse.json({
          reply: `**${contacts.length}** contact(s):\n${contacts.map((c, i) => `  ${i + 1}. **${c.name ?? 'Unnamed'}** ${c.phone ? '— ' + c.phone : ''}${c.company ? ' (' + c.company + ')' : ''}`).join('\n')}`,
          action: { type: 'list', status: 'success' as const, detail: `${contacts.length} contacts` },
        })
      }

      case 'get_contact': {
        if (!target) return NextResponse.json({ reply: 'Which contact? Try "show contact [name or phone]".' })
        const c = await handleGetContact(user.id, target)
        if (!c) return NextResponse.json({ reply: `No contact found matching "${target}".` })
        const conv = await findConversation(user.id, target)
        return NextResponse.json({
          reply: `**${c.name ?? 'Unnamed'}**\nPhone: ${c.phone ?? '—'}\nEmail: ${c.email ?? '—'}\nCompany: ${c.company ?? '—'}\nAdded: ${new Date(c.created_at).toLocaleDateString()}\nConversation: ${conv ? (conv.status === 'open' ? 'Open' : 'Closed') : 'None'}`,
          action: { type: 'details', status: 'success' as const, detail: c.name ?? c.phone },
        })
      }

      case 'create_contact': {
        const c = await handleCreateContact(user.id, message)
        if (!c) return NextResponse.json({ reply: 'Usage: "create contact \\"Name\\" with phone 1234567890" (name and phone required).' })
        return NextResponse.json({
          reply: `Created contact **${c.name}** (${c.phone}).`,
          action: { type: 'created', status: 'success' as const, detail: c.name },
        })
      }

      case 'update_contact': {
        if (!target) return NextResponse.json({ reply: 'Which contact to update?' })
        const c = await handleUpdateContact(user.id, target, message)
        if (!c) return NextResponse.json({ reply: `Could not update "${target}".` })
        return NextResponse.json({
          reply: `Updated **${c.name ?? 'contact'}**.`,
          action: { type: 'updated', status: 'success' as const, detail: c.name },
        })
      }

      case 'delete_contact': {
        if (!target) return NextResponse.json({ reply: 'Which contact to delete?' })
        const c = await handleDeleteContact(user.id, target)
        if (!c) return NextResponse.json({ reply: `"${target}" not found.` })
        return NextResponse.json({
          reply: `Deleted contact **${c.name ?? c.phone}**.`,
          action: { type: 'deleted', status: 'success' as const },
        })
      }

      case 'tag_contact': {
        if (!target) return NextResponse.json({ reply: 'Usage: "tag contact [name] with [tag name]".' })
        const result = await handleTagContact(user.id, target, message)
        if (!result) return NextResponse.json({ reply: 'Contact not found.' })
        return NextResponse.json({
          reply: `Tagged **${result.contact.name}** with **${result.tag?.name ?? 'tag'}**.`,
          action: { type: 'tagged', status: 'success' as const },
        })
      }

      case 'untag_contact': {
        if (!target) return NextResponse.json({ reply: 'Usage: "remove tag [tag name] from contact [name]".' })
        const result = await handleUntagContact(user.id, target, message)
        if (!result) return NextResponse.json({ reply: 'Contact not found.' })
        return NextResponse.json({
          reply: `Removed **${result.tag?.name ?? 'tag'}** from **${result.contact.name}**.`,
          action: { type: 'untagged', status: 'success' as const },
        })
      }

      // ── Conversations ──
      case 'list_conversations': {
        const convs = await handleListConversations(user.id)
        if (convs.length === 0) return NextResponse.json({
          reply: 'No conversations yet. They appear when customers message you on WhatsApp.',
          action: { type: 'list', status: 'success' as const, detail: '0 conversations' },
        })
        return NextResponse.json({
          reply: `**${convs.length}** conversation(s):\n${convs.map((c: any, i: number) => `  ${i + 1}. **${c.contact?.name ?? c.contact?.phone ?? 'Unknown'}** — ${formatConversationStatus(c.status)}${c.unread_count > 0 ? ` (${c.unread_count} unread)` : ''}`).join('\n')}`,
          action: { type: 'list', status: 'success' as const, detail: `${convs.length} conversations` },
        })
      }

      case 'get_conversation': {
        if (!target) return NextResponse.json({ reply: 'Which conversation? Try "show conversation with [name]".' })
        const result = await handleGetConversation(user.id, target)
        if (!result) return NextResponse.json({ reply: `No conversation with "${target}".` })
        const { conversation: conv, messages } = result
        const lastMessages = messages.slice(-5).reverse().map((m: any) =>
          `  [${new Date(m.created_at).toLocaleTimeString()}] ${m.sender_type === 'customer' ? (conv as any).contact?.name ?? 'Customer' : 'You'}: ${m.content_text ?? m.content_type}`
        ).join('\n')
        return NextResponse.json({
          reply: `**${(conv as any).contact?.name ?? 'Conversation'}** — ${formatConversationStatus(conv.status)}\n\n**Last messages:**\n${lastMessages || '  (no messages)'}`,
          action: { type: 'details', status: 'success' as const },
        })
      }

      case 'send_message': {
        if (!target) return NextResponse.json({ reply: 'Usage: "send message to [name] saying \\"your text\\"."' })
        const result = await handleSendMessage(user.id, target, message)
        if (!result) return NextResponse.json({ reply: `No conversation with "${target}" found.` })
        return NextResponse.json({
          reply: `Message sent to **${(result.conversation as any).contact?.name ?? target}**.`,
          action: { type: 'sent', status: 'success' as const },
        })
      }

      case 'close_conversation': {
        if (!target) return NextResponse.json({ reply: 'Which conversation to close?' })
        const c = await handleCloseConversation(user.id, target)
        if (!c) return NextResponse.json({ reply: `"${target}" not found.` })
        return NextResponse.json({
          reply: `Conversation with **${(c as any).contact?.name ?? target}** closed.`,
          action: { type: 'closed', status: 'success' as const },
        })
      }

      case 'reopen_conversation': {
        if (!target) return NextResponse.json({ reply: 'Which conversation to reopen?' })
        const c = await handleReopenConversation(user.id, target)
        if (!c) return NextResponse.json({ reply: `"${target}" not found.` })
        return NextResponse.json({
          reply: `Conversation with **${(c as any).contact?.name ?? target}** reopened.`,
          action: { type: 'reopened', status: 'success' as const },
        })
      }

      case 'assign_conversation': {
        if (!target) return NextResponse.json({ reply: 'Usage: "assign conversation [name] to [agent]".' })
        const result = await handleAssignConversation(user.id, target, message)
        if (!result) return NextResponse.json({ reply: 'Conversation not found.' })
        return NextResponse.json({
          reply: `Assignment noted for conversation with **${target}**.`,
          action: { type: 'assigned', status: 'success' as const },
        })
      }

      // ── Broadcasts ──
      case 'list_broadcasts': {
        const bcs = await handleListBroadcasts(user.id)
        if (bcs.length === 0) return NextResponse.json({
          reply: 'No broadcasts yet. Create one: "create a broadcast \\"Promo\\" with template \\"welcome_template\\"".',
          action: { type: 'list', status: 'success' as const, detail: '0 broadcasts' },
        })
        return NextResponse.json({
          reply: `**${bcs.length}** broadcast(s):\n${bcs.map((b, i) => `  ${i + 1}. **${b.name}** — ${formatBroadcastStatus(b.status)} (template: ${b.template_name}, ${b.total_recipients} recipients)`).join('\n')}`,
          action: { type: 'list', status: 'success' as const },
        })
      }

      case 'create_broadcast': {
        const { broadcast, reason } = await handleCreateBroadcast(user.id, message)
        if (!broadcast) return NextResponse.json({
          reply: reason === 'template_name' ? 'Please specify a template name in quotes: "create a broadcast \\"Name\\" with template \\"template_name\\"."' : 'Failed to create broadcast.',
          action: { type: 'error', status: 'error' as const },
        })
        return NextResponse.json({
          reply: `Created draft broadcast **${broadcast.name}** using template "${broadcast.template_name}". Configure recipients in the Broadcasts section.`,
          action: { type: 'created', status: 'success' as const, detail: broadcast.name },
        })
      }

      // ── Pipelines & Deals ──
      case 'list_pipelines': {
        const pips = await handleListPipelines(user.id)
        if (pips.length === 0) return NextResponse.json({
          reply: 'No pipelines yet. You can create them in the Pipelines section.',
          action: { type: 'list', status: 'success' as const, detail: '0 pipelines' },
        })
        return NextResponse.json({
          reply: `**${pips.length}** pipeline(s):\n${pips.map((p, i) => `  ${i + 1}. **${p.name}**`).join('\n')}`,
          action: { type: 'list', status: 'success' as const },
        })
      }

      case 'list_deals': {
        const deals = await handleListDeals(user.id)
        if (deals.length === 0) return NextResponse.json({
          reply: 'No deals yet. Create one: "create a deal \\"Big Corp\\" worth 10000 in \\"Sales Pipeline\\"."',
          action: { type: 'list', status: 'success' as const, detail: '0 deals' },
        })
        return NextResponse.json({
          reply: `**${deals.length}** deal(s):\n${deals.map((d: any, i: number) => `  ${i + 1}. **${d.title}** — $${d.value ?? 0} (${d.pipeline?.name ?? '?'} / ${d.stage?.name ?? '?'}) [${formatDealStatus(d.status)}]`).join('\n')}`,
          action: { type: 'list', status: 'success' as const },
        })
      }

      case 'create_deal': {
        const d = await handleCreateDeal(user.id, message)
        if (!d) return NextResponse.json({
          reply: 'Usage: "create a deal \\"Title\\" worth [amount] in \\"Pipeline Name\\"". Make sure the pipeline exists.',
          action: { type: 'error', status: 'error' as const },
        })
        return NextResponse.json({
          reply: `Created deal **${d.title}** worth $${d.value}.`,
          action: { type: 'created', status: 'success' as const, detail: d.title },
        })
      }

      case 'move_deal': {
        if (!target) return NextResponse.json({ reply: 'Which deal to move?' })
        const result = await handleMoveDeal(user.id, target, message)
        if (!result) return NextResponse.json({ reply: `Deal "${target}" not found.` })
        if ('moved' in result && !result.moved) return NextResponse.json({ reply: 'Could not find the target stage. Use a stage name from the pipeline.' })
        return NextResponse.json({
          reply: `Moved **${(result as Deal).title}** to a new stage.`,
          action: { type: 'moved', status: 'success' as const },
        })
      }

      case 'status_deal': {
        if (!target) return NextResponse.json({ reply: 'Which deal?' })
        const d = await handleStatusDeal(user.id, target, message)
        if (!d) return NextResponse.json({ reply: `Deal "${target}" not found.` })
        return NextResponse.json({
          reply: `**${d.title}** marked as ${d.status}.`,
          action: { type: 'status_changed', status: 'success' as const },
        })
      }

      // ── Tags ──
      case 'list_tags': {
        const tags = await handleListTags(user.id)
        if (tags.length === 0) return NextResponse.json({
          reply: 'No tags yet. Create one: "create a tag \\"VIP\\"". Tags help organize contacts.',
          action: { type: 'list', status: 'success' as const, detail: '0 tags' },
        })
        return NextResponse.json({
          reply: `**${tags.length}** tag(s):\n${tags.map((t, i) => `  ${i + 1}. **${t.name}**`).join('\n')}`,
          action: { type: 'list', status: 'success' as const },
        })
      }

      case 'create_tag': {
        const t = await handleCreateTag(user.id, message)
        if (!t) return NextResponse.json({ reply: 'Usage: "create a tag \\"Name\\"".' })
        return NextResponse.json({
          reply: `Created tag **${t.name}**.`,
          action: { type: 'created', status: 'success' as const, detail: t.name },
        })
      }

      // ── Templates ──
      case 'list_templates': {
        const templates = await handleListTemplates(user.id)
        if (templates.length === 0) return NextResponse.json({
          reply: 'No message templates. Sync from WhatsApp in Settings > Templates or create them in Meta Business Manager.',
          action: { type: 'list', status: 'success' as const },
        })
        return NextResponse.json({
          reply: `**${templates.length}** template(s):\n${templates.map((t, i) => `  ${i + 1}. **${t.name}** — ${t.category} (${t.status})`).join('\n')}`,
          action: { type: 'list', status: 'success' as const },
        })
      }

      // ── Dashboard ──
      case 'dashboard': {
        try {
          const m = await handleDashboard(user.id)
          return NextResponse.json({
            reply: `**Dashboard Snapshot**\n- Active conversations: ${m?.activeConversations ?? '?'}\n- New contacts today: ${m?.newContactsToday ?? '?'}\n- Messages sent today: ${m?.messagesSentToday ?? '?'}\n- Open deals: ${m?.openDealsCount ?? '?'} ($${m?.openDealsValue ?? '?'})`,
            action: { type: 'dashboard', status: 'success' as const },
          })
        } catch {
          return NextResponse.json({
            reply: 'Could not load dashboard metrics right now.',
            action: { type: 'error', status: 'error' as const },
          })
        }
      }

      // ── WhatsApp ──
      case 'whatsapp_status': {
        const config = await handleWhatsAppStatus(user.id)
        if (!config) return NextResponse.json({
          reply: 'WhatsApp is **not configured**. Go to Settings > WhatsApp to connect your Meta Business account.',
          action: { type: 'status', status: 'error' as const },
        })
        return NextResponse.json({
          reply: `WhatsApp is **${config.status === 'connected' ? 'connected' : 'disconnected'}**.\nPhone Number ID: ${config.phone_number_id}\nConnected: ${config.connected_at ? new Date(config.connected_at).toLocaleDateString() : 'N/A'}`,
          action: { type: 'status', status: 'success' as const },
        })
      }

      // ── Help ──
      case 'help': {
        return NextResponse.json({
          reply: `I can manage your entire CRM. Try these:\n\n**Automations**\n"Show automations" / "Create a welcome automation" / "Pause all" / "Logs for [name]"\n\n**Contacts**\n"List contacts" / "Show contact John" / "Create contact \\"Jane\\" with phone 1234" / "Tag contact John with VIP"\n\n**Conversations**\n"Show conversations" / "Send message to John saying \\"Hi\\"" / "Close conversation with Jane"\n\n**Deals**\n"List deals" / "Create a deal \\"Big Sale\\" worth 5000 in \\"Pipeline\\"" / "Mark deal X as won"\n\n**Broadcasts**\n"List broadcasts" / "Create a broadcast \\"Promo\\" with template \\"hello\\""\n\n**Other**\n"Show my tags" / "WhatsApp status" / "Dashboard summary"`,
          action: { type: 'help', status: 'success' as const },
        })
      }

      default: {
        return NextResponse.json({
          reply: `I did not understand that. I manage automations, contacts, conversations, deals, broadcasts, tags, and more.\n\nTry "help" for the full command list, or ask something like:\n- "Show my automations"\n- "List contacts"\n- "Dashboard summary"\n- "WhatsApp status"`,
          action: { type: 'unrecognized', status: 'error' as const },
        })
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json(
      { reply: `Error: ${msg}`, action: { type: 'error', status: 'error' as const, detail: msg } },
    )
  }
}

// ─── SHARED ────────────────────────────────────────────────

function stepPreview(step: { step_type: string; step_config: Record<string, unknown> }): string {
  const c = step.step_config
  switch (step.step_type) {
    case 'send_message': return `Send: "${String(c.text ?? '').slice(0, 50)}${String(c.text ?? '').length > 50 ? '...' : ''}"`
    case 'send_template': return `Template: ${String(c.template_name ?? '?')}`
    case 'add_tag': return `Add tag: ${String(c.tag_id ?? '?')}`
    case 'remove_tag': return `Remove tag: ${String(c.tag_id ?? '?')}`
    case 'assign_conversation': return `Assign: ${String(c.mode ?? 'round_robin')}`
    case 'update_contact_field': return `Update ${String(c.field ?? '?')} = ${String(c.value ?? '')}`
    case 'create_deal': return `Create deal: ${String(c.title ?? '?')}`
    case 'wait': return `Wait ${String(c.amount ?? '?')} ${String(c.unit ?? '')}`
    case 'condition': return `If ${String(c.subject ?? '?')} ${String(c.operand ?? '')}`
    case 'send_webhook': return `Webhook: ${String(c.url ?? '').slice(0, 40)}`
    case 'close_conversation': return 'Close conversation'
    default: return step.step_type
  }
}
