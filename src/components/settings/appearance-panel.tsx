"use client";

import { Check, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function AppearancePanel() {
  const { theme, setTheme, isDark, toggleDark } = useTheme();
  return (
    <section className="space-y-6">
      {/* Dark / Light toggle */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Appearance
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Choose between light and dark mode, then pick an accent color.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => toggleDark()}
          className={cn(
            "relative flex h-10 w-20 items-center rounded-full transition-colors",
            isDark ? "bg-[#1a1a2e]" : "bg-[var(--bg-secondary)]",
          )}
          style={{
            border: "1px solid var(--border-color)",
            boxShadow: "var(--shadow-diffusion)",
          }}
          aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        >
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-transform",
              isDark
                ? "translate-x-10 bg-[#2a2a45] text-[#00f0ff]"
                : "translate-x-1 bg-white text-[#3a3a5c]",
            )}
            style={{ boxShadow: "var(--glass-inner)" }}
          >
            {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </span>
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {isDark ? "Dark mode" : "Light mode"}
        </span>
      </div>

      {/* Color accent picker */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Accent color
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Choose a signature hue for buttons, highlights, and active navigation. Works in both light and dark mode.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            tagline={t.tagline}
            swatch={t.swatch}
            isActive={t.id === theme}
            onPick={() => setTheme(t.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Use ${name} theme`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors",
        "bg-[var(--card-bg)]",
        isActive
          ? "border-[var(--primary)]/60 ring-2 ring-[var(--primary)]/40"
          : "border-[var(--border-color)] hover:border-[var(--border-color)] hover:bg-[var(--hover-bg)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
            <Check className="h-3 w-3" />
            Active
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {name}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span
          className="w-3"
          style={{ background: "var(--bg-primary)" }}
        />
        <span
          className="w-3"
          style={{ background: "var(--bg-secondary)" }}
        />
        <span
          className="w-3"
          style={{ background: "var(--muted)" }}
        />
      </div>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
