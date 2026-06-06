"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface ModelOption {
  alias: string;
  id: string;
  label: string;
  cost_hint: string;
}

interface ModelState {
  current_id: string;
  current_alias: string;
  options: ModelOption[];
}

export default function ModelSettingsPage() {
  const authed = useRequireAuth();
  const qc = useQueryClient();
  const state = useQuery<ModelState>({
    queryKey: ["model"],
    queryFn: () => api.get("/api/model"),
    enabled: authed === true,
  });

  const pick = useMutation<{ ok: boolean; current_alias: string }, Error, string>({
    mutationFn: (alias) => api.put("/api/model", { alias }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["model"] }),
  });

  if (!authed) return null;

  const current = state.data?.current_alias;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Model" }]} />
      <header className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-widest text-gold">Settings</p>
        <h1 className="font-display text-3xl">AI model</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Choose the model behind your agent + all drafting. Higher tiers write
          sharper but cost more per message. Your daily spend cap still applies.
        </p>
      </header>

      <div className="space-y-3">
        {state.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
        {state.data?.options.map((o) => {
          const selected = o.alias === current;
          return (
            <button
              key={o.alias}
              onClick={() => !selected && pick.mutate(o.alias)}
              disabled={pick.isPending}
              className={`flex w-full items-center justify-between rounded-card border p-4 text-left transition ${
                selected
                  ? "border-gold bg-gold/10"
                  : "border-bg-graphite bg-bg-ink hover:border-gold/50"
              } disabled:opacity-60`}
            >
              <div>
                <div className="font-display text-base text-white">{o.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{o.cost_hint}</div>
              </div>
              <div
                className={`ml-4 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-gold bg-gold text-black" : "border-bg-graphite"
                }`}
              >
                {selected ? "✓" : ""}
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Default is Haiku 4.5. You can also switch from Telegram with{" "}
        <code className="text-gold">/model opus</code>.
      </p>
    </main>
  );
}
