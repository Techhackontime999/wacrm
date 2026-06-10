"use client"

import { createContext, useContext, useCallback, useRef, type ReactNode } from "react"

interface AiContextValue {
  onSuggestion: (text: string) => void
  onSendTemplate: (name: string, params: string[]) => void
  onTriggerFlow: (flowId: string, action: "trigger" | "resume") => void
  /** Register a callback to receive text suggestions. */
  registerSuggestionTarget: (fn: ((text: string) => void) | null) => void
}

const AiContext = createContext<AiContextValue | null>(null)

export function AiProvider({
  children,
  onSendTemplate,
  onTriggerFlow,
}: {
  children: ReactNode
  onSendTemplate: (name: string, params: string[]) => void
  onTriggerFlow: (flowId: string, action: "trigger" | "resume") => void
}) {
  const suggestionTargetRef = useRef<((text: string) => void) | null>(null)

  const registerSuggestionTarget = useCallback((fn: ((text: string) => void) | null) => {
    suggestionTargetRef.current = fn
  }, [])

  const onSuggestion = useCallback((text: string) => {
    suggestionTargetRef.current?.(text)
  }, [])

  return (
    <AiContext.Provider value={{ onSuggestion, onSendTemplate, onTriggerFlow, registerSuggestionTarget }}>
      {children}
    </AiContext.Provider>
  )
}

export function useAi(): AiContextValue {
  const ctx = useContext(AiContext)
  if (!ctx) throw new Error("useAi must be used within AiProvider")
  return ctx
}
