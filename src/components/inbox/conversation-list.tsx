"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-slate-500",
};

const FILTER_OPTIONS: { label: string; value: ConversationStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [loading, setLoading] = useState(true);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // Full width on mobile (grid controls the column size on md+).
    <div className="flex h-full w-full flex-col border-r border-slate-800 bg-slate-900">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-slate-800 p-[clamp(0.5rem,1.5vw,0.75rem)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-[clamp(0.875rem,1.25vw,1.125rem)] w-[clamp(0.875rem,1.25vw,1.125rem)] -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search conversations..."
            className="border-slate-700 bg-slate-800 pl-[clamp(2rem,3vw,2.5rem)] text-[clamp(0.8125rem,1.1vw,0.875rem)] text-white placeholder-slate-500 transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-primary/50 h-[clamp(2rem,3vw,2.5rem)]"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-[clamp(1.5rem,2.25vw,2rem)] gap-1 px-[clamp(0.375rem,0.6vw,0.5rem)] text-[clamp(0.6875rem,0.9vw,0.75rem)] text-slate-400 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-white rounded-md hover:bg-slate-800 active:scale-[0.96]">
              {activeFilter?.label ?? "All"}
              <ChevronDown className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-slate-700 bg-slate-800"
          >
            {FILTER_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  "text-sm",
                  filter === opt.value
                    ? "text-primary"
                    : "text-slate-300"
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-[clamp(0.5rem,1.5vw,0.75rem)] px-[clamp(0.5rem,1.5vw,0.75rem)] py-[clamp(0.625rem,1.25vw,0.875rem)]">
                <div className="h-[clamp(2.25rem,4.5vw,3rem)] w-[clamp(2.25rem,4.5vw,3rem)] shrink-0 animate-pulse rounded-full bg-slate-800" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-[clamp(0.75rem,1vw,0.875rem)] w-[clamp(5rem,12vw,7rem)] animate-pulse rounded bg-slate-800" />
                    <div className="h-[clamp(0.625rem,0.8vw,0.75rem)] w-[clamp(2rem,5vw,2.5rem)] animate-pulse rounded bg-slate-800" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(6rem,18vw,10rem)] animate-pulse rounded bg-slate-800" />
                    <div className="flex items-center gap-1.5">
                      <div className="h-[clamp(0.75rem,1vw,0.875rem)] w-[clamp(1rem,2.5vw,1.25rem)] animate-pulse rounded-full bg-slate-800" />
                      <div className="h-[clamp(0.375rem,0.6vw,0.5rem)] w-[clamp(0.375rem,0.6vw,0.5rem)] animate-pulse rounded-full bg-slate-800" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-[clamp(0.5rem,1.5vw,0.75rem)] px-[clamp(0.5rem,1.5vw,0.75rem)] py-[clamp(0.625rem,1.25vw,0.875rem)] text-left transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-slate-800/50 active:scale-[0.98]",
        isActive && "border-l-[0.125rem] border-primary bg-slate-800/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-[clamp(2.25rem,4.5vw,3rem)] w-[clamp(2.25rem,4.5vw,3rem)] shrink-0 items-center justify-center rounded-full bg-slate-700 text-[clamp(0.75rem,1.25vw,0.875rem)] font-medium text-white">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[clamp(0.8125rem,1.25vw,0.9375rem)] font-medium text-white">
            {displayName}
          </span>
          <span className="shrink-0 text-[clamp(0.625rem,0.9vw,0.75rem)] text-slate-500">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[clamp(0.6875rem,1vw,0.8125rem)] text-slate-400">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-[clamp(1rem,1.5vw,1.25rem)] min-w-[clamp(1rem,1.5vw,1.25rem)] items-center justify-center rounded-full bg-primary px-[clamp(0.25rem,0.4vw,0.375rem)] text-[clamp(0.625rem,0.8vw,0.6875rem)] font-bold text-primary-foreground">
                {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-[clamp(0.375rem,0.6vw,0.5rem)] w-[clamp(0.375rem,0.6vw,0.5rem)] rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
