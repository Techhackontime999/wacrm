"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { NeuralLogo } from "@/components/ui/neural-logo";
import { ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);
  const supabase = createClient();

  useEffect(() => { setMounted(true); }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--glass-bg)",
    backdropFilter: "blur(32px)",
    WebkitBackdropFilter: "blur(32px)",
    borderColor: "var(--border-color)",
    boxShadow: "var(--shadow-diffusion)",
  };

  const inputStyle: React.CSSProperties = {
    borderColor: "var(--border-color)",
    background: "var(--input-bg)",
    color: "var(--text-primary)",
  };

  const animStyle = (delay: number): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(20px)",
    transition: `opacity 0.5s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
  });

  if (success) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4" style={{ background: "var(--bg-primary)" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 60%)", opacity: 0.12 }} />
        <div className="relative z-10 w-full max-w-md px-6" style={animStyle(0)}>
          <div className="rounded-2xl border p-8 text-center" style={cardStyle}>
            <div className="mb-4 flex justify-center">
              <NeuralLogo size="large" />
            </div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Check Your Email
            </h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              We sent a password reset link to <strong style={{ color: "var(--accent-glow)" }}>{email}</strong>.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ background: "var(--primary)" }}
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4" style={{ background: "var(--bg-primary)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 60%)", opacity: 0.12 }} />

      <div className="relative z-10 w-full max-w-md px-6" style={animStyle(0)}>
        <div className="rounded-2xl border p-8" style={cardStyle}>
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4">
              <NeuralLogo size="large" />
            </div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Reset Password
            </h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Enter your email and we&apos;ll send you a reset link
            </p>
          </div>

          <form onSubmit={handleReset} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none transition-colors focus:ring-1"
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--primary)" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </span>
              ) : (
                "Send Reset Link"
              )}
            </button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-2 text-xs hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
