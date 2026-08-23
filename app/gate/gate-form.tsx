"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GateForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      // The gate is rendered in place of the requested page, so a reload lands
      // on whatever the visitor actually asked for.
      window.location.reload();
      return;
    }
    setPending(false);
    setError("That password didn't work.");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending || !password} className="w-full">
        {pending ? "Checking…" : "Unlock"}
      </Button>
    </form>
  );
}
