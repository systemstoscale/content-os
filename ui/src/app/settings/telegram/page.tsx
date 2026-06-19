"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Connect / repair the Telegram control surface after onboarding. Mirrors the
 *  guided wizard step: paste a bot token (BotFather) → we store it + register
 *  the webhook → send /start. Status polls live. */

interface TgStatus {
  token_set: boolean;
  webhook_registered: boolean;
  owner_linked: boolean;
}

export default function TelegramSettings() {
  const authed = useRequireAuth();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const status = useQuery<TgStatus>({
    queryKey: ["telegram-status"],
    queryFn: () => api.get<TgStatus>("/api/setup/telegram-status"),
    refetchInterval: (q) => (q.state.data?.owner_linked ? false : 4000),
    enabled: !!authed,
  });

  const save = useMutation<{ ok: boolean; error?: string }, Error, void>({
    mutationFn: () =>
      api.post("/api/setup/telegram-webhook", token.trim() ? { telegram_bot_token: token.trim() } : {}),
    onSuccess: (r) => {
      setMsg(r.ok ? "Webhook registered. Now send /start to your bot." : `Failed: ${r.error ?? "unknown"}`);
      setToken("");
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    },
    onError: (e) => setMsg(String(e)),
  });

  if (!authed) return null;
  const s = status.data;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Telegram" }]} />
      <header className="mt-4 mb-8">
        <h1 className="font-display text-3xl">Connect Telegram</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Telegram is your remote control — drop a video, get a finished reel back. Create a bot once and paste its token.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">Status</h2>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <StatusRow ok={s?.token_set} label="Bot token saved" />
          <StatusRow ok={s?.webhook_registered} label="Webhook registered" />
          <StatusRow ok={s?.owner_linked} pending={!s?.owner_linked} label={s?.owner_linked ? "You're linked (/start received)" : "Send /start to your bot"} />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">Create your bot</h2>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-zinc-300">
            <li>
              Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-gold underline">@BotFather</a> in Telegram.
            </li>
            <li>Send <code className="text-gold">/newbot</code> → name it → username ending in <code className="text-gold">bot</code>.</li>
            <li>Paste the token BotFather gives you below.</li>
          </ol>

          <div>
            <div className="mb-1 text-sm font-semibold text-white">Bot token</div>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:ABCdef…  (leave blank to just re-register)"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 pr-14 font-mono text-sm focus:border-gold focus:outline-none"
              />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-gold">
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {msg && <p className="text-xs text-gold/90">{msg}</p>}

          <div className="flex gap-3">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="flex-[2]">
              {save.isPending ? "Connecting…" : token.trim() ? "Save & connect →" : "Re-register webhook"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function StatusRow({ ok, label, pending }: { ok?: boolean; label: string; pending?: boolean }) {
  const icon = ok ? "✅" : pending ? "⏳" : "❌";
  return (
    <div className="flex items-center gap-2">
      <span>{icon}</span>
      <span className={ok ? "text-zinc-200" : "text-zinc-400"}>{label}</span>
    </div>
  );
}
