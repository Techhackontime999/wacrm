"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import {
  Send, Bot, User, Terminal, Trash2, Loader2,
  Zap, List, Plus, Activity, HelpCircle,
  Users, MessageSquare, LayoutDashboard, Radio,
  GitBranch, Tags, FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AutomationRef {
  id: string
  name: string
  is_active: boolean
}

interface ActionInfo {
  type: string
  status: "pending" | "success" | "error"
  detail?: string
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  action?: ActionInfo
  automations?: AutomationRef[]
}

interface QuickAction {
  label: string
  icon: typeof Zap
  prompt: string
  category: string
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Show automations", icon: Zap, prompt: "Show my automations", category: "Automations" },
  { label: "Create welcome", icon: Plus, prompt: "Create a welcome automation", category: "Automations" },
  { label: "Pause all", icon: Activity, prompt: "Pause all automations", category: "Automations" },

  { label: "List contacts", icon: Users, prompt: "Show my contacts", category: "Contacts" },
  { label: "Dashboard", icon: LayoutDashboard, prompt: "Show me the dashboard", category: "CRM" },
  { label: "Show deals", icon: GitBranch, prompt: "Show my deals", category: "CRM" },
  { label: "Conversations", icon: MessageSquare, prompt: "Show my conversations", category: "CRM" },
  { label: "Broadcasts", icon: Radio, prompt: "Show my broadcasts", category: "CRM" },
  { label: "WhatsApp status", icon: MessageSquare, prompt: "WhatsApp status", category: "CRM" },
  { label: "Help", icon: HelpCircle, prompt: "Help", category: "General" },
]

export function AiChatbox() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "I manage your entire CRM through natural language. Automations, contacts, conversations, deals, broadcasts, tags — just ask.\n\nTry a quick action below or type what you need.",
      timestamp: new Date(),
      action: { type: "ready", status: "success" },
    },
  ])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [showAllActions, setShowAllActions] = useState(false)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const adjustHeight = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  const handleSend = useCallback(async (text?: string) => {
    const trimmed = (text ?? input).trim()
    if (!trimmed || sending) return

    setSending(true)
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    if (!text) {
      setInput("")
      if (inputRef.current) inputRef.current.style.height = "auto"
    }

    const thinkingId = `thinking-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: thinkingId, role: "assistant", content: "", timestamp: new Date(), action: { type: "processing", status: "pending" } },
    ])

    try {
      const res = await fetch("/api/ai-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Request failed")

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                ...m,
                content: data.reply,
                action: data.action ? { ...data.action, status: "success" } : undefined,
                automations: data.automations,
              }
            : m,
        ),
      )
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                ...m,
                content: err instanceof Error ? err.message : "Something went wrong",
                action: { type: "error", status: "error", detail: "Request failed" },
              }
            : m,
        ),
      )
    } finally {
      setSending(false)
    }
  }, [input, sending])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const clearChat = useCallback(() => {
    setMessages([
      {
        id: "intro",
        role: "assistant",
        content: "Chat cleared. How can I help with your CRM?",
        timestamp: new Date(),
        action: { type: "ready", status: "success" },
      },
    ])
  }, [])

  const hasSentMessage = messages.length > 1

  const visibleActions = showAllActions ? QUICK_ACTIONS : QUICK_ACTIONS.slice(0, 6)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">AI CRM Assistant</h2>
            <p className="text-[11px] text-slate-400">Full CRM natural language control</p>
          </div>
        </div>
        <button
          type="button"
          onClick={clearChat}
          aria-label="Clear conversation"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.05),transparent_50%)]"
      >
        <div className="space-y-1 px-4 py-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 py-3",
                msg.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {msg.role === "assistant" && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[88%] space-y-1.5 sm:max-w-[75%]",
                  msg.role === "user" && "items-end flex flex-col",
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border border-slate-800 bg-slate-900 text-slate-100",
                  )}
                >
                  {msg.action?.type === "processing" && !msg.content ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-slate-400">Processing...</span>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  )}

                  {msg.action && msg.action.status !== "pending" && (
                    <div
                      className={cn(
                        "mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
                        msg.action.status === "success"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400",
                      )}
                    >
                      <Terminal className="h-3 w-3" />
                      <span className="capitalize">{msg.action.type.replace(/_/g, " ")}</span>
                      {msg.action.detail && (
                        <span className="text-slate-500">&mdash; {msg.action.detail}</span>
                      )}
                    </div>
                  )}

                  {msg.automations && msg.automations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.automations.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => handleSend(`show automation ${a.name}`)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-primary/30 hover:text-white"
                        >
                          <Zap className={cn("h-3 w-3", a.is_active ? "text-primary" : "text-slate-500")} />
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className={cn("px-1 text-[10px] text-slate-600", msg.role === "user" && "text-right")}>
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>

              {msg.role === "user" && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!hasSentMessage && (
        <div className="border-t border-slate-800/50 px-4 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Quick Actions
          </p>
          <div className="flex flex-wrap gap-2">
            {visibleActions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.prompt}
                  type="button"
                  onClick={() => handleSend(action.prompt)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-primary/30 hover:bg-slate-800 hover:text-white"
                >
                  <Icon className="h-3 w-3" />
                  {action.label}
                </button>
              )
            })}
            {!showAllActions && QUICK_ACTIONS.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllActions(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-700 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-primary/30 hover:text-white"
              >
                +{QUICK_ACTIONS.length - 6} more
              </button>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-slate-800 bg-slate-900/50 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything: automations, contacts, deals, conversations..."
            rows={1}
            disabled={sending}
            className="flex-1 resize-none overflow-hidden rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          />

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.96] disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-600">
          Automations &middot; Contacts &middot; Conversations &middot; Deals &middot; Broadcasts &middot; Tags &middot; Dashboard &middot; Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
