"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { fetchSetupStatus, clearSetupCache } from "@/lib/setup";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Step = 1 | 2 | 3;

interface SetupForm {
  email: string;
  creator_name: string;
  creator_timezone: string;
  zernio_profile_id: string;
  yt_account_id: string;
  telegram_chat_id: string;
}

const EMPTY: SetupForm = {
  email: "",
  creator_name: "",
  creator_timezone: "UTC",
  zernio_profile_id: "",
  yt_account_id: "",
  telegram_chat_id: "",
};

interface SetupResult {
  ok: boolean;
  email?: string;
  initial_password?: string;
  bearer_token?: string;
  worker_url?: string;
  error?: string;
}

export default function Setup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<SetupForm>(EMPTY);
  const [done, setDone] = useState<SetupResult | null>(null);

  // Guard: if setup is already done, redirect to /login.
  useEffect(() => {
    fetchSetupStatus(true).then((s) => {
      if (s?.setup_complete) router.replace("/login");
    });
  }, [router]);

  function set<K extends keyof SetupForm>(k: K, v: SetupForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  const complete = useMutation<SetupResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await res.json()) as SetupResult;
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return body;
    },
    onSuccess: (data) => {
      clearSetupCache();
      setDone(data);
    },
  });

  // Final step: show credentials, link to login.
  if (done) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
        <h1 className="mb-6 font-display text-3xl">Content OS is live</h1>
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">
              Your sign-in credentials
            </h2>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label="Email" value={<code className="text-gold">{done.email}</code>} />
            <Row
              label="Initial password"
              value={<code className="font-display text-gold">{done.initial_password}</code>}
            />
            <Row
              label="Bearer token (API/curl)"
              value={
                <code className="break-all text-xs text-zinc-300">{done.bearer_token}</code>
              }
            />
            <p className="mt-4 text-xs text-zinc-500">
              Save the password somewhere safe (1Password, etc.). You'll be asked to set a permanent one on first sign-in.
            </p>
          </CardBody>
        </Card>
        <Button onClick={() => router.push("/login")} className="w-full">
          Sign in →
        </Button>
        <p className="mt-6 text-xs text-zinc-500">
          Lost the password? Re-deploy from GitHub OR ask your Skalers operator to run <code className="text-gold">./reset-password.sh</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
      <header className="mb-8">
        <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
        <h1 className="font-display text-3xl">Set up Content OS</h1>
        <p className="mt-3 text-sm text-zinc-400">
          One-time setup. The Cloudflare deploy already provisioned your D1 + KV + R2 + Worker —
          we just need to know who's running it, then we'll generate your sign-in credentials.
        </p>
      </header>

      <Stepper current={step} />

      {complete.error && (
        <Card className="mb-4 bg-red-500/10 p-4 text-sm text-red-200">
          {String(complete.error)}
        </Card>
      )}

      {step === 1 && (
        <Step1
          form={form}
          set={set}
          onContinue={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2
          form={form}
          set={set}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <StepReview
          form={form}
          busy={complete.isPending}
          onBack={() => setStep(2)}
          onComplete={() => complete.mutate()}
        />
      )}
    </main>
  );
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function Step1({
  form,
  set,
  onContinue,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  onContinue: () => void;
}) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 1 · Who are you?</h2>

      <Field label="Your email" hint="Used as your sign-in email and where draft previews land.">
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="you@yourbusiness.com"
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
          autoFocus
        />
      </Field>

      <Field label="Creator display name" hint="How the agent introduces you in content + emails.">
        <input
          type="text"
          value={form.creator_name}
          onChange={(e) => set("creator_name", e.target.value)}
          placeholder="Maxime Warnault"
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
      </Field>

      <Field label="Timezone (IANA)" hint="Drives the 7am daily content cron + email timestamps.">
        <input
          type="text"
          value={form.creator_timezone}
          onChange={(e) => set("creator_timezone", e.target.value)}
          placeholder="America/New_York"
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 font-mono text-sm focus:border-gold focus:outline-none"
        />
      </Field>

      <Button
        onClick={onContinue}
        disabled={!form.email.trim() || !form.creator_name.trim()}
        className="w-full"
      >
        Continue →
      </Button>
    </section>
  );
}

function Step2({
  form,
  set,
  onBack,
  onContinue,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 2 · Zernio</h2>
      <p className="text-sm text-zinc-400">
        Zernio publishes your posts to IG / TikTok / LinkedIn / YouTube / etc. You already paste
        your API key during the Cloudflare deploy. Now we need your profile + channel ids.
      </p>

      <Field
        label="Zernio profile ID"
        hint="The 24-character code in your profile URL."
      >
        <input
          type="text"
          value={form.zernio_profile_id}
          onChange={(e) => set("zernio_profile_id", e.target.value)}
          placeholder="695061a982617b5c3fd7edf1"
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 font-mono text-sm focus:border-gold focus:outline-none"
        />
        <HowTo
          steps={[
            "Open zernio.com/dashboard and sign in.",
            "Click your profile (top-right) — the page URL becomes zernio.com/profile/<id>.",
            "Copy the 24-character <id> from that URL and paste it here.",
          ]}
        />
      </Field>

      <Field
        label="Zernio YouTube account ID"
        hint="Optional — only needed to publish YouTube long-form."
      >
        <input
          type="text"
          value={form.yt_account_id}
          onChange={(e) => set("yt_account_id", e.target.value)}
          placeholder="697de5f893a320156c426b36"
          className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 font-mono text-sm focus:border-gold focus:outline-none"
        />
        <HowTo
          steps={[
            "In Zernio, go to Accounts and click your connected YouTube channel.",
            "The 24-character id is in that account's URL.",
            "Skip this if you're not publishing long-form YouTube.",
          ]}
        />
      </Field>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={onContinue} className="flex-[2]">
          Continue →
        </Button>
      </div>
    </section>
  );
}

function StepReview({
  form,
  busy,
  onBack,
  onComplete,
}: {
  form: SetupForm;
  busy: boolean;
  onBack: () => void;
  onComplete: () => void;
}) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 3 · Review &amp; finish</h2>

      <Card>
        <CardBody className="space-y-2 text-sm">
          <Row label="Email" value={<code className="text-gold">{form.email}</code>} />
          <Row label="Creator" value={form.creator_name} />
          <Row label="Timezone" value={form.creator_timezone} />
          <Row label="Zernio profile" value={form.zernio_profile_id || <span className="text-zinc-600">unset</span>} />
          <Row label="Zernio YouTube account" value={form.yt_account_id || <span className="text-zinc-600">unset</span>} />
        </CardBody>
      </Card>

      <p className="rounded-card border border-gold/40 bg-gold/5 p-3 text-xs text-gold/90">
        On submit we'll seed the database, generate a memorable password, and show your credentials on the next screen.
      </p>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1" disabled={busy}>
          Back
        </Button>
        <Button onClick={onComplete} disabled={busy} className="flex-[2]">
          {busy ? "Setting up…" : "Finish setup →"}
        </Button>
      </div>
    </section>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Stepper({ current }: { current: Step }) {
  return (
    <div className="mb-8 flex gap-2 text-xs uppercase">
      {([1, 2, 3] as Step[]).map((s) => (
        <div
          key={s}
          className={`flex-1 rounded border px-2 py-1 text-center ${
            s === current
              ? "border-gold bg-gold/10 text-gold"
              : s < current
                ? "border-bg-graphite bg-bg-ink text-zinc-400"
                : "border-bg-graphite text-zinc-600"
          }`}
        >
          {s}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-white">{label}</div>
      {hint && <div className="mb-2 text-xs text-zinc-500">{hint}</div>}
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}

/** Collapsible "how to get this" helper — plain-English steps, no jargon. */
function HowTo({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-gold/80 hover:text-gold"
      >
        {open ? "Hide" : "How do I find this?"}
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 rounded-card border border-bg-graphite bg-black/40 px-5 py-3 text-xs text-zinc-400">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
