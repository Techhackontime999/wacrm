"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { NeuralLogo } from "@/components/ui/neural-logo";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);
  const supabase = createClient();

  useEffect(() => { setMounted(true); }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
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

  if (success) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4" style={{ background: "var(--bg-primary)" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 60%)", opacity: 0.12 }} />
        <div
          className="relative z-10 w-full max-w-md px-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div className="rounded-2xl border p-8 text-center" style={cardStyle}>
            <div className="mb-4 flex justify-center">
              <NeuralLogo size="large" />
            </div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Check Your Email
            </h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              We sent a confirmation link to <strong style={{ color: "var(--accent-glow)" }}>{email}</strong>. Click it to activate your account, then sign in.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ background: "var(--primary)" }}
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4" style={{ background: "var(--bg-primary)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 60%)", opacity: 0.12 }} />

      <div
        className="relative z-10 w-full max-w-md px-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className="rounded-2xl border p-8" style={cardStyle}>
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4">
              <NeuralLogo size="large" />
            </div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Create Account
            </h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Register to access the dashboard
            </p>
          </div>

          <form onSubmit={handleSignup} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Full name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                required
                className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none transition-colors focus:ring-1"
                style={inputStyle}
              />
            </div>

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

            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none transition-colors focus:ring-1"
                style={inputStyle}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
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
                  Creating account...
                </span>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
            Already have an account?{" "}
            <Link href="/login" className="hover:underline" style={{ color: "var(--accent-glow)" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
