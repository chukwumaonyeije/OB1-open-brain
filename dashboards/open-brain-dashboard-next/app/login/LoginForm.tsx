"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const apiKey = String(formData.get("apiKey") ?? "").trim();

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Sign in failed");
        return;
      }

      window.location.assign("/");
    } catch {
      setError("Could not sign in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="apiKey"
          className="block text-sm font-medium text-text-secondary mb-1.5"
        >
          MCP Access Key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoFocus
          placeholder="your-api-key"
          className="w-full px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
        />
      </div>

      {error && (
        <p className="text-danger text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Verifying..." : "Sign in"}
      </button>
    </form>
  );
}
