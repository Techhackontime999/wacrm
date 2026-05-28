"use client"

import { AiChatbox } from "@/components/ai-automation/ai-chatbox"

export default function AiAutomationPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          AI Automation
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Use natural language to create and manage your WhatsApp automations.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-lg">
        <AiChatbox />
      </div>
    </div>
  )
}
