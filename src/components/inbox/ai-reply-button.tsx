"use client"

import { useState, useCallback } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAi } from "@/lib/ai/context"

interface AiReplyButtonProps {
  conversationId: string
}

export function AiReplyButton({ conversationId }: AiReplyButtonProps) {
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const { onSuggestion, onSendTemplate, onTriggerFlow } = useAi()

  const fetchSuggestion = useCallback(async () => {
    setLoading(true)
    setSuggestion(null)
    try {
      const res = await fetch("/api/ai-reply/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        console.error("[ai-reply] API error:", data.error)
        return
      }
      const data = await res.json() as {
        suggestion?: string | null
        template_recommendation?: { id: string; name: string; params: string[] } | null
        flow_suggestion?: { id: string; name: string; action: string } | null
      }

      if (data.suggestion) {
        onSuggestion(data.suggestion)
        setSuggestion(data.suggestion)
      } else if (data.template_recommendation) {
        onSendTemplate(data.template_recommendation.name, data.template_recommendation.params)
      } else if (data.flow_suggestion) {
        onTriggerFlow(data.flow_suggestion.id, data.flow_suggestion.action as "trigger" | "resume")
      }
    } catch (err) {
      console.error("[ai-reply] fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [conversationId, onSuggestion, onSendTemplate, onTriggerFlow])

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="text-slate-400 hover:text-white max-sm:size-10"
      onClick={fetchSuggestion}
      disabled={loading}
      title="AI Reply"
    >
      <Sparkles className={`size-4 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  )
}
