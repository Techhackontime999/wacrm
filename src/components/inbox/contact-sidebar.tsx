"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Back/close handler for mobile & tablet overlay mode. */
  onClose?: () => void;
}

export function ContactSidebar({ contact, onClose }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-full items-center justify-center border-l border-slate-800 bg-slate-900">
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col border-l border-slate-800 bg-slate-900">
      {onClose && (
        <div className="flex items-center gap-2 border-b border-slate-800 px-[clamp(0.5rem,1.25vw,0.75rem)] py-[clamp(0.5rem,1vw,0.75rem)]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to conversation"
            className="flex h-[clamp(1.75rem,3vw,2.25rem)] w-[clamp(1.75rem,3vw,2.25rem)] items-center justify-center rounded-md text-slate-300 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-slate-800 hover:text-white active:scale-[0.92]"
          >
            <ArrowLeft className="h-[clamp(0.75rem,1.25vw,1rem)] w-[clamp(0.75rem,1.25vw,1rem)]" />
          </button>
          <span className="text-[clamp(0.8125rem,1.1vw,0.875rem)] font-medium text-slate-300">Contact info</span>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-[clamp(0.75rem,2vw,1.5rem)]">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-[clamp(3rem,6vw,5rem)] w-[clamp(3rem,6vw,5rem)] items-center justify-center rounded-full bg-slate-700 text-[clamp(0.875rem,2vw,1.25rem)] font-semibold text-white">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-[clamp(0.8125rem,1.25vw,1rem)] font-semibold text-white">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-[clamp(0.6875rem,0.9vw,0.8125rem)] text-slate-400">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-[clamp(0.75rem,1.5vw,1.25rem)] space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-[clamp(0.375rem,0.75vw,0.625rem)] text-[clamp(0.8125rem,1.1vw,0.875rem)] text-slate-300 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-slate-800 active:scale-[0.98]"
            >
              <Phone className="h-[clamp(0.75rem,1.25vw,1rem)] w-[clamp(0.75rem,1.25vw,1rem)] text-slate-500" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)] text-primary" />
              ) : (
                <Copy className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)] text-slate-600" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-[clamp(0.375rem,0.75vw,0.625rem)] text-[clamp(0.8125rem,1.1vw,0.875rem)] text-slate-300">
                <Mail className="h-[clamp(0.75rem,1.25vw,1rem)] w-[clamp(0.75rem,1.25vw,1rem)] text-slate-500" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-[clamp(0.75rem,1.5vw,1.25rem)] border-t border-slate-800" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[clamp(0.625rem,0.8vw,0.6875rem)] font-medium uppercase tracking-wider text-slate-500">
              <TagIcon className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)]" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-[clamp(0.6875rem,0.9vw,0.75rem)] text-slate-600">No tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-[clamp(0.375rem,0.6vw,0.5rem)] py-0.5 text-[clamp(0.5625rem,0.75vw,0.625rem)] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-[clamp(0.75rem,1.5vw,1.25rem)] border-t border-slate-800" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[clamp(0.625rem,0.8vw,0.6875rem)] font-medium uppercase tracking-wider text-slate-500">
              <DollarSign className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)]" />
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-[clamp(0.6875rem,0.9vw,0.75rem)] text-slate-600">No deals</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <p className="text-[clamp(0.8125rem,1.1vw,0.875rem)] font-medium text-white">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[clamp(0.6875rem,0.9vw,0.75rem)] text-slate-400">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-[clamp(0.25rem,0.5vw,0.375rem)] py-0.5 text-[clamp(0.5625rem,0.75vw,0.625rem)]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-[clamp(0.75rem,1.5vw,1.25rem)] border-t border-slate-800" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[clamp(0.625rem,0.8vw,0.6875rem)] font-medium uppercase tracking-wider text-slate-500">
              <StickyNote className="h-[clamp(0.625rem,0.9vw,0.75rem)] w-[clamp(0.625rem,0.9vw,0.75rem)]" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[clamp(0.6875rem,0.9vw,0.75rem)] text-white placeholder-slate-500 outline-none transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-primary/50"
                />
                <Button
                  size="icon-lg"
                  className="bg-primary transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-primary/90 active:scale-[0.92]"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  aria-label="Add note"
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-[clamp(0.6875rem,0.9vw,0.75rem)] text-slate-300">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[clamp(0.5625rem,0.75vw,0.625rem)] text-slate-600">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
