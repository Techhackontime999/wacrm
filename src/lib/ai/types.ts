export interface ToolParameterProperty {
  type: string
  description: string
  enum?: string[]
  items?: { type: string }
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, ToolParameterProperty>
      required: string[]
    }
  }
}

export interface AiToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: AiToolCall[]
  tool_call_id?: string
  name?: string
}

export interface AiChoice {
  message: AiMessage
  finish_reason: "stop" | "tool_calls" | string
}

export interface AiResponse {
  choices: AiChoice[]
}

export type CrmAction =
  | { action: "list_automations"; params: {} }
  | { action: "get_automation"; params: { name: string } }
  | { action: "create_automation_from_template"; params: { template: string } }
  | { action: "create_automation"; params: { name: string; trigger_type?: string } }
  | { action: "delete_automation"; params: { name: string } }
  | { action: "duplicate_automation"; params: { name: string } }
  | { action: "activate_automation"; params: { name: string } }
  | { action: "deactivate_automation"; params: { name: string } }
  | { action: "activate_all_automations"; params: {} }
  | { action: "deactivate_all_automations"; params: {} }
  | { action: "rename_automation"; params: { name: string; new_name: string } }
  | { action: "get_automation_logs"; params: { name: string } }
  | { action: "list_contacts"; params: {} }
  | { action: "get_contact"; params: { name_or_phone: string } }
  | { action: "create_contact"; params: { name: string; phone: string; email?: string; company?: string } }
  | { action: "update_contact"; params: { name_or_phone: string; name?: string; phone?: string; email?: string; company?: string } }
  | { action: "delete_contact"; params: { name_or_phone: string } }
  | { action: "tag_contact"; params: { contact: string; tag: string } }
  | { action: "untag_contact"; params: { contact: string; tag: string } }
  | { action: "list_conversations"; params: {} }
  | { action: "get_conversation"; params: { contact: string } }
  | { action: "send_message"; params: { contact: string; text: string } }
  | { action: "close_conversation"; params: { contact: string } }
  | { action: "reopen_conversation"; params: { contact: string } }
  | { action: "list_deals"; params: {} }
  | { action: "create_deal"; params: { title: string; value?: number; pipeline?: string } }
  | { action: "move_deal"; params: { title: string; stage: string } }
  | { action: "mark_deal_won"; params: { title: string } }
  | { action: "mark_deal_lost"; params: { title: string } }
  | { action: "list_pipelines"; params: {} }
  | { action: "list_broadcasts"; params: {} }
  | { action: "create_broadcast"; params: { name: string; template_name: string } }
  | { action: "list_tags"; params: {} }
  | { action: "create_tag"; params: { name: string; color?: string } }
  | { action: "list_templates"; params: {} }
  | { action: "get_dashboard"; params: {} }
  | { action: "get_whatsapp_status"; params: {} }
  | { action: "unknown"; params: {} }
  | { action: "help"; params: {} }
  | { action: "reply"; params: { text: string } }
