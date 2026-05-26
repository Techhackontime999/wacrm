"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NeuralLogo } from "@/components/ui/neural-logo";

export default function ApprovalPendingPage() {
  const [mounted, setMounted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => { setMounted(true); }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 60%)",
          opacity: 0.12,
        }}
      />

      <div
        className="relative z-10 w-full max-w-md px-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div
          className="rounded-2xl border p-8 text-center"
          style={{
            background: "var(--glass-bg)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            borderColor: "var(--border-color)",
            boxShadow: "var(--shadow-diffusion)",
          }}
        >
          <div className="mb-4 flex justify-center">
            <NeuralLogo size="large" />
          </div>
          <h1
            className="mb-2 text-2xl font-bold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Account Pending Approval
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Your account has been created and is currently awaiting approval
            from an administrator. You will be notified once your account
            has been activated.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: "var(--primary-soft)" }}
            >
              <svg
                className="h-8 w-8"
                style={{ color: "var(--primary)" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <p
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Please check back later.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-8 inline-flex w-full items-center justify-center rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--primary)" }}
          >
            {signingOut ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Signing out...
              </span>
            ) : (
              "Sign Out"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
