"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface ConfigEntry {
  key: string;
  value: string | null;
  label: string;
  hint: string;
  validate: "meta_account" | "meta_page" | null;
}

interface ConfigList {
  values: ConfigEntry[];
}

export default function ConfigSettings() {
  const authed = useRequireAuth();
  const queryClient = useQueryClient();

  const list = useQuery<ConfigList>({
    queryKey: ["config-list"],
    queryFn: () => api.get("/api/config"),
    enabled: authed === true,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Config" }]} />
      <Link href="/settings/health" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← Health
      </Link>

      <header className="mt-2 mb-8">
        <h1 className="font-display text-3xl">Settings · Configuration</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Creator profile + channel IDs the agent uses. Most of these are set at install time; edit here if anything changes.
        </p>
      </header>

      {list.isLoading && <p className="text-sm text-zinc-500">Loading config…</p>}
      {list.error && (
        <Card className="bg-red-500/10 p-4 text-sm text-red-200">{String(list.error)}</Card>
      )}

      <div className="space-y-3">
        {list.data?.values.map((entry) => (
          <ConfigRow
            key={entry.key}
            entry={entry}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["config-list"] })}
          />
        ))}
      </div>
    </main>
  );
}

function ConfigRow({
  entry,
  onSaved,
}: {
  entry: ConfigEntry;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(entry.value ?? "");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync local state if the underlying value changes (e.g. another tab edits).
  useEffect(() => {
    setValue(entry.value ?? "");
  }, [entry.value]);

  const dirty = (value || null) !== (entry.value || null);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.put(`/api/config/${entry.key}`, { value });
      setSuccess("Saved ✓");
      setTimeout(() => setSuccess(null), 3000);
      onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function validate() {
    setValidating(true);
    setError(null);
    setSuccess(null);
    try {
      const r = (await api.post(`/api/config/${entry.key}/validate`, { value })) as {
        ok: boolean;
        message?: string;
      };
      if (r.ok) setSuccess(r.message ?? "OK");
      else setError(r.message ?? "Validation failed");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setValidating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">{entry.label}</div>
            <div className="text-xs text-zinc-500">{entry.hint}</div>
          </div>
          <code className="hidden font-mono text-xs text-zinc-600 sm:inline">{entry.key}</code>
        </div>
      </CardHeader>
      <CardBody className="space-y-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 font-mono text-sm focus:border-gold focus:outline-none"
          placeholder={entry.value ?? "unset"}
        />
        {error && (
          <div className="rounded-card border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-card border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {success}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {entry.validate && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={validate}
              disabled={validating || !value}
            >
              {validating ? "Checking…" : "Validate against Meta"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || !dirty}
            className="ml-auto"
          >
            {saving ? "Saving…" : value ? "Save" : "Clear value"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
