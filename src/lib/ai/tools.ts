import type { ToolDefinition } from "./types"

export const CRM_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_automations",
      description: "List all automations for the user",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_automation",
      description: "Get details of a specific automation by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_automation_from_template",
      description: "Create an automation from a built-in template (welcome_message, out_of_office, lead_qualifier, follow_up_reminder)",
      parameters: {
        type: "object",
        properties: { template: { type: "string", enum: ["welcome_message", "out_of_office", "lead_qualifier", "follow_up_reminder"], description: "The template slug" } },
        required: ["template"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_automation",
      description: "Create a new custom automation",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the automation" },
          trigger_type: { type: "string", enum: ["new_message_received", "first_inbound_message", "keyword_match", "new_contact_created", "conversation_assigned", "tag_added", "time_based"], description: "When the automation triggers (optional)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_automation",
      description: "Delete an automation by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation to delete" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_automation",
      description: "Duplicate an automation by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation to duplicate" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_automation",
      description: "Activate (enable) an automation by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deactivate_automation",
      description: "Deactivate (pause) an automation by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_all_automations",
      description: "Activate all automations at once",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "deactivate_all_automations",
      description: "Deactivate (pause) all automations at once",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_automation",
      description: "Rename an automation",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The current name of the automation" },
          new_name: { type: "string", description: "The new name" },
        },
        required: ["name", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_automation_logs",
      description: "View execution logs for an automation",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The name of the automation" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contacts",
      description: "List all contacts",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact",
      description: "Get details of a specific contact by name or phone number",
      parameters: {
        type: "object",
        properties: { name_or_phone: { type: "string", description: "The name or phone number of the contact" } },
        required: ["name_or_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_contact",
      description: "Create a new contact",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Contact's name" },
          phone: { type: "string", description: "Contact's phone number" },
          email: { type: "string", description: "Contact's email (optional)" },
          company: { type: "string", description: "Contact's company (optional)" },
        },
        required: ["name", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_contact",
      description: "Update an existing contact's details",
      parameters: {
        type: "object",
        properties: {
          name_or_phone: { type: "string", description: "Current name or phone to identify the contact" },
          name: { type: "string", description: "New name (optional)" },
          phone: { type: "string", description: "New phone (optional)" },
          email: { type: "string", description: "New email (optional)" },
          company: { type: "string", description: "New company (optional)" },
        },
        required: ["name_or_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_contact",
      description: "Delete a contact by name or phone",
      parameters: {
        type: "object",
        properties: { name_or_phone: { type: "string", description: "The name or phone of the contact to delete" } },
        required: ["name_or_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_contact",
      description: "Add a tag to a contact (creates the tag if it does not exist)",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "The contact's name or phone" },
          tag: { type: "string", description: "The tag name" },
        },
        required: ["contact", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "untag_contact",
      description: "Remove a tag from a contact",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "The contact's name or phone" },
          tag: { type: "string", description: "The tag name" },
        },
        required: ["contact", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_conversations",
      description: "List all conversations",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_conversation",
      description: "Get conversation details and recent messages with a contact",
      parameters: {
        type: "object",
        properties: { contact: { type: "string", description: "The contact's name or phone" } },
        required: ["contact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_message",
      description: "Send a text message to a contact's conversation",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "The contact's name or phone" },
          text: { type: "string", description: "The message text to send" },
        },
        required: ["contact", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_conversation",
      description: "Close a conversation with a contact",
      parameters: {
        type: "object",
        properties: { contact: { type: "string", description: "The contact's name or phone" } },
        required: ["contact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reopen_conversation",
      description: "Reopen a closed conversation with a contact",
      parameters: {
        type: "object",
        properties: { contact: { type: "string", description: "The contact's name or phone" } },
        required: ["contact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_deals",
      description: "List all deals with their pipeline and stage information",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_deal",
      description: "Create a new deal in a pipeline",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The deal title" },
          value: { type: "number", description: "The deal value in dollars (optional)" },
          pipeline: { type: "string", description: "The pipeline name (optional, uses first if not specified)" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_deal",
      description: "Move a deal to a different stage in its pipeline",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The deal title" },
          stage: { type: "string", description: "The target stage name" },
        },
        required: ["title", "stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_deal_won",
      description: "Mark a deal as won",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "The deal title" } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_deal_lost",
      description: "Mark a deal as lost",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "The deal title" } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pipelines",
      description: "List all sales pipelines",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_pipeline",
      description: "Create a new sales pipeline",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The pipeline name" },
          stages: { type: "string", description: "Comma-separated list of stage names (optional, e.g. 'Lead,Qualified,Proposal,Closed')" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_pipeline",
      description: "Delete a pipeline by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The pipeline name to delete" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pipeline_stage",
      description: "Add a stage to an existing pipeline",
      parameters: {
        type: "object",
        properties: {
          pipeline: { type: "string", description: "The pipeline name" },
          stage: { type: "string", description: "The new stage name" },
        },
        required: ["pipeline", "stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_broadcasts",
      description: "List all broadcasts",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_broadcast",
      description: "Create a new draft broadcast",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The broadcast name" },
          template_name: { type: "string", description: "The WhatsApp message template name to use" },
        },
        required: ["name", "template_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tags",
      description: "List all tags",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_tag",
      description: "Create a new tag",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The tag name" },
          color: { type: "string", description: "Hex color code (optional, e.g. #6366f1)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_templates",
      description: "List all WhatsApp message templates",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard",
      description: "Get a dashboard summary with metrics (active conversations, new contacts, messages, deals)",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_whatsapp_status",
      description: "Check if WhatsApp is connected and configured",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "send_broadcast",
      description: "Send a draft broadcast to all its recipients",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The broadcast name" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_broadcast",
      description: "Delete a broadcast by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The broadcast name to delete" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_tag",
      description: "Delete a tag by name",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The tag name to delete" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_contact_note",
      description: "Add a note to a contact",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "The contact's name or phone" },
          note: { type: "string", description: "The note text" },
        },
        required: ["contact", "note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contact_notes",
      description: "List notes for a contact",
      parameters: {
        type: "object",
        properties: { contact: { type: "string", description: "The contact's name or phone" } },
        required: ["contact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_conversation",
      description: "Assign a conversation to an agent for handling",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "The contact's name or phone" },
          agent: { type: "string", description: "The agent's name or email to assign to" },
        },
        required: ["contact", "agent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_automation_step",
      description: "Add a step to an existing automation",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The automation name" },
          step_type: { type: "string", enum: ["send_message", "send_template", "add_tag", "remove_tag", "assign_conversation", "update_contact_field", "create_deal", "wait", "condition", "send_webhook", "close_conversation"], description: "The type of step to add" },
          config: { type: "string", description: "A JSON string or description of the step configuration (e.g. '{\"text\":\"Hello!\"}' for send_message)" },
        },
        required: ["name", "step_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_automation_step",
      description: "Remove a step from an automation by its position number",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The automation name" },
          position: { type: "number", description: "The step number to remove (1-based)" },
        },
        required: ["name", "position"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply",
      description: "Respond to the user with a text message (use this for general chat, greetings, or when no specific CRM action is needed)",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The response text" } },
        required: ["text"],
      },
    },
  },
]
