"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchSetupStatus, clearSetupCache } from "@/lib/setup";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Guided onboarding. Captures everything a buyer needs in-app — their own
 *  password, every API key (stored in CONFIG KV by the Worker), and a guided
 *  Telegram connect — so the system actually works the moment setup finishes.
 *  No Cloudflare dashboard, nothing to guess. */

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS = ["Account", "Keys", "Telegram", "Extras"];

interface SetupForm {
  // account
  email: string;
  password: string;
  password2: string;
  creator_name: string;
  creator_timezone: string;
  // required keys
  anthropic_api_key: string;
  groq_api_key: string;
  zernio_api_key: string;
  zernio_profile_id: string;
  cloudflare_account_id: string;
  r2_access_key_id: string;
  r2_secret_access_key: string;
  content_os_license_key: string;
  // telegram (required step)
  telegram_bot_token: string;
  // optional power-ups
  kie_ai_api_key: string;
  elevenlabs_api_key: string;
}

const EMPTY: SetupForm = {
  email: "",
  password: "",
  password2: "",
  creator_name: "",
  creator_timezone: "UTC",
  anthropic_api_key: "",
  groq_api_key: "",
  zernio_api_key: "",
  zernio_profile_id: "",
  cloudflare_account_id: "",
  r2_access_key_id: "",
  r2_secret_access_key: "",
  content_os_license_key: "",
  telegram_bot_token: "",
  kie_ai_api_key: "",
  elevenlabs_api_key: "",
};

interface SetupResult {
  ok: boolean;
  email?: string;
  bearer_token?: string;
  worker_url?: string;
  telegram_registered?: boolean;
  license_valid?: boolean;
  license_reason?: string;
  error?: string;
}

const MIN_PW = 12;

/** Signup links. Where we own an affiliate, route through a skalers.io/<slug>
 *  short link (Max controls the underlying URL). Others go direct.
 *  groq + kie are direct pending an affiliate program. */
const LINKS = {
  anthropic: "https://skalers.io/claude",
  groq: "https://console.groq.com/keys",
  zernio: "https://skalers.io/zernio",
  cloudflareAccount: "https://dash.cloudflare.com",
  cloudflareR2: "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
  kie: "https://kie.ai",
  elevenlabs: "https://skalers.io/elevenlabs",
  license: "https://10xcontent.io",
} as const;

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
    // Prefill the timezone from the browser. (The R2 bucket is NOT asked for —
    // the Deploy button always provisions the fixed `content-os-assets` bucket
    // and the Worker serves from it, so there's nothing for the buyer to name.)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setForm((p) => ({
        ...p,
        ...(tz ? { creator_timezone: tz } : {}),
      }));
    } catch {
      /* keep defaults */
    }
  }, [router]);

  function set<K extends keyof SetupForm>(k: K, v: SetupForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  // Finish: create the install, then auto-login with the chosen password.
  const complete = useMutation<SetupResult, Error, void>({
    mutationFn: async () => {
      // strip the confirm field before sending
      const { password2: _omit, ...payload } = form;
      void _omit;
      const result = await api.post<SetupResult>("/api/setup/complete", payload);
      // Log straight in with the password they just chose (no forced change).
      await api.post("/api/auth/login", { email: form.email.trim().toLowerCase(), password: form.password });
      return result;
    },
    onSuccess: (data) => {
      clearSetupCache();
      setDone(data);
    },
  });

  if (done) return <DoneScreen result={done} onOpen={() => router.push("/")} />;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
      <header className="mb-8">
        <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
        <h1 className="font-display text-3xl">Set up Content OS</h1>
        <p className="mt-3 text-sm text-zinc-400">
          A few minutes, all in one place. You'll pick a password, paste your keys, and connect
          Telegram — then drop a video and get a finished, captioned reel back.
        </p>
      </header>

      <Stepper current={step} />

      {complete.error && (
        <Card className="mb-4 bg-red-500/10 p-4 text-sm text-red-200">{String(complete.error)}</Card>
      )}

      {step === 1 && <StepAccount form={form} set={set} onNext={() => setStep(2)} />}
      {step === 2 && <StepKeys form={form} set={set} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <StepTelegram form={form} set={set} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
      {step === 4 && (
        <StepExtras
          form={form}
          set={set}
          busy={complete.isPending}
          onBack={() => setStep(3)}
          onFinish={() => complete.mutate()}
        />
      )}
    </main>
  );
}

// ─── Step 1 · Account ──────────────────────────────────────────────────────────

function StepAccount({
  form,
  set,
  onNext,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  onNext: () => void;
}) {
  const pwTooShort = form.password.length > 0 && form.password.length < MIN_PW;
  const mismatch = form.password2.length > 0 && form.password !== form.password2;
  const ready =
    !!form.email.trim() &&
    !!form.creator_name.trim() &&
    form.password.length >= MIN_PW &&
    form.password === form.password2;

  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 1 · Your account</h2>

      <Field label="Your email" hint="Your sign-in email + where draft previews land.">
        <TextInput value={form.email} onChange={(v) => set("email", v)} type="email" placeholder="you@yourbusiness.com" autoFocus />
      </Field>

      <Field label="Choose a password" hint={`At least ${MIN_PW} characters. You set it now — no temporary password to lose.`}>
        <SecretInput value={form.password} onChange={(v) => set("password", v)} placeholder="••••••••••••" />
        {pwTooShort && <p className="mt-1 text-xs text-red-300">Too short — needs {MIN_PW}+ characters.</p>}
      </Field>

      <Field label="Confirm password">
        <SecretInput value={form.password2} onChange={(v) => set("password2", v)} placeholder="••••••••••••" />
        {mismatch && <p className="mt-1 text-xs text-red-300">Passwords don't match.</p>}
      </Field>

      <Field label="Creator display name" hint="How the agent introduces you in content + emails.">
        <TextInput value={form.creator_name} onChange={(v) => set("creator_name", v)} placeholder="Maxime Warnault" />
      </Field>

      <Field label="Timezone" hint="Drives the daily content cron + timestamps. We auto-detect yours — change it if needed.">
        <TimezoneSelect value={form.creator_timezone} onChange={(v) => set("creator_timezone", v)} />
      </Field>

      <Button onClick={onNext} disabled={!ready} className="w-full">
        Continue →
      </Button>
    </section>
  );
}

// ─── Step 2 · Required keys ─────────────────────────────────────────────────────

function StepKeys({
  form,
  set,
  onBack,
  onNext,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const required: (keyof SetupForm)[] = [
    "anthropic_api_key",
    "groq_api_key",
    "zernio_api_key",
    "zernio_profile_id",
    "cloudflare_account_id",
    "r2_access_key_id",
    "r2_secret_access_key",
    "content_os_license_key",
  ];
  const ready = required.every((k) => String(form[k]).trim().length > 0);

  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 2 · Connect your keys</h2>
      <p className="text-sm text-zinc-400">
        Paste each key once — we store them securely in your own Cloudflare account. Every field has
        a "Where do I get this?" if you're not sure.
      </p>

      <SecretField label="Anthropic API key" value={form.anthropic_api_key} onChange={(v) => set("anthropic_api_key", v)} placeholder="sk-ant-…"
        how={["Sign up via the link below, then Settings → API Keys → Create Key.", "This is the editing + caption brain."]} link={LINKS.anthropic} />

      <SecretField label="Groq API key" value={form.groq_api_key} onChange={(v) => set("groq_api_key", v)} placeholder="gsk_…"
        how={["Sign up via the link below, then API Keys → Create API Key.", "Used for fast, word-accurate transcription."]} link={LINKS.groq} />

      <SecretField label="Zernio API key" value={form.zernio_api_key} onChange={(v) => set("zernio_api_key", v)} placeholder="zrn_…"
        how={["Sign up via the link below, then Settings → API → Create key.", "This is how we publish to IG / TikTok / YouTube / LinkedIn / FB."]} link={LINKS.zernio} />

      <Field label="Zernio profile ID" hint="The 24-character code in your Zernio profile URL.">
        <TextInput value={form.zernio_profile_id} onChange={(v) => set("zernio_profile_id", v)} mono placeholder="695061a982617b5c3fd7edf1" />
        <HowTo steps={["In Zernio, click your profile (top-right).", "The URL becomes zernio.com/profile/<id>.", "Copy the 24-character <id> here."]} />
      </Field>

      <p className="pt-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">Cloudflare R2 (where your finished reels are stored)</p>

      <Field label="Cloudflare Account ID" hint="Found on your Cloudflare dashboard home, right sidebar.">
        <TextInput value={form.cloudflare_account_id} onChange={(v) => set("cloudflare_account_id", v)} mono placeholder="32aba2b3…" />
        <HowTo steps={["Open dash.cloudflare.com.", "On the right sidebar (or any Workers/R2 page) copy 'Account ID'."]} />
      </Field>

      <SecretField label="R2 Access Key ID" value={form.r2_access_key_id} onChange={(v) => set("r2_access_key_id", v)} placeholder="…"
        how={["Cloudflare → R2 → Manage R2 API Tokens → Create API token.", "Permission: Object Read & Write. Copy the Access Key ID.", "Paste the Secret Access Key in the next field."]} link={LINKS.cloudflareR2} />

      <SecretField label="R2 Secret Access Key" value={form.r2_secret_access_key} onChange={(v) => set("r2_secret_access_key", v)} placeholder="…"
        how={["This is the second value shown when you created the R2 API token above.", "It's only shown once — if you missed it, create a new token."]} />

      <SecretField label="Content OS license key" value={form.content_os_license_key} onChange={(v) => set("content_os_license_key", v)} placeholder="cos_…"
        how={["This came with your purchase at 10xcontent.io (check your receipt email).", "It unlocks rendering + publishing."]} link={LINKS.license} />

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1">Back</Button>
        <Button onClick={onNext} disabled={!ready} className="flex-[2]">Continue →</Button>
      </div>
      {!ready && <p className="text-center text-xs text-zinc-500">All fields above are required to continue.</p>}
    </section>
  );
}

// ─── Step 3 · Telegram (guided) ─────────────────────────────────────────────────

function StepTelegram({
  form,
  set,
  onBack,
  onNext,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const ready = form.telegram_bot_token.trim().length > 0;
  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 3 · Connect Telegram</h2>
      <p className="text-sm text-zinc-400">
        Telegram is your remote control — drop a video, tap a format, get a finished reel back. Create
        a bot once (it's free, ~30 seconds):
      </p>

      <ol className="list-decimal space-y-2 rounded-card border border-bg-graphite bg-black/40 px-5 py-4 text-sm text-zinc-300">
        <li>
          Open{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-gold underline">
            @BotFather
          </a>{" "}
          in Telegram.
        </li>
        <li>Send <code className="text-gold">/newbot</code> → pick a name → pick a username ending in <code className="text-gold">bot</code>.</li>
        <li>BotFather replies with a <strong>token</strong> like <code className="text-gold">123456:ABC-DEF…</code> — paste it below.</li>
      </ol>

      <SecretField
        label="Telegram bot token"
        value={form.telegram_bot_token}
        onChange={(v) => set("telegram_bot_token", v)}
        placeholder="123456789:ABCdef…"
        how={["It's the long token BotFather sends right after you create the bot.", "We register the webhook for you when you finish — then you just send /start."]}
      />

      <p className="rounded-card border border-gold/40 bg-gold/5 p-3 text-xs text-gold/90">
        After you finish setup we'll auto-connect the webhook, then ask you to send <code>/start</code> to
        your new bot — the dashboard confirms it live.
      </p>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1">Back</Button>
        <Button onClick={onNext} disabled={!ready} className="flex-[2]">Continue →</Button>
      </div>
    </section>
  );
}

// ─── Step 4 · Optional power-ups + finish ───────────────────────────────────────

function StepExtras({
  form,
  set,
  busy,
  onBack,
  onFinish,
}: {
  form: SetupForm;
  set: <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => void;
  busy: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-lg">Step 4 · Power-ups (optional)</h2>
      <p className="text-sm text-zinc-400">Skip these and add them later in Settings — everything core works without them.</p>

      <SecretField label="KIE.AI API key" value={form.kie_ai_api_key} onChange={(v) => set("kie_ai_api_key", v)} placeholder="(optional)"
        how={["Unlocks AI thumbnails + AI images + talking-head avatar reels.", "Sign up via the link below, then API."]} link={LINKS.kie} />

      <SecretField label="ElevenLabs API key" value={form.elevenlabs_api_key} onChange={(v) => set("elevenlabs_api_key", v)} placeholder="(optional)"
        how={["Unlocks voice-cloned TTS for avatar reels.", "Sign up via the link below, then Profile → API Keys."]} link={LINKS.elevenlabs} />

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1" disabled={busy}>Back</Button>
        <Button onClick={onFinish} disabled={busy} className="flex-[2]">
          {busy ? "Setting up…" : "Finish setup →"}
        </Button>
      </div>
    </section>
  );
}

// ─── Done screen ────────────────────────────────────────────────────────────────

interface TgStatus {
  token_set: boolean;
  webhook_registered: boolean;
  owner_linked: boolean;
}

function DoneScreen({ result, onOpen }: { result: SetupResult; onOpen: () => void }) {
  // Poll Telegram status until the owner sends /start.
  const tg = useQuery<TgStatus>({
    queryKey: ["setup", "telegram-status"],
    queryFn: () => api.get<TgStatus>("/api/setup/telegram-status"),
    refetchInterval: (q) => (q.state.data?.owner_linked ? false : 3000),
    enabled: !!result.telegram_registered,
  });

  const ownerLinked = tg.data?.owner_linked ?? false;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
      <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
      <h1 className="mb-6 font-display text-3xl">🎉 Content OS is live</h1>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">Setup checklist</h2>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <Check ok label="Account created — you're signed in" />
          <Check ok label="API keys saved to your Cloudflare account" />
          <Check ok={result.license_valid} label={result.license_valid ? "License active" : `License: ${result.license_reason ?? "not active"}`} />
          <Check ok={ownerLinked} pending={!ownerLinked} label={ownerLinked ? "Telegram connected" : "Telegram — send /start to your bot"} />
        </CardBody>
      </Card>

      {result.telegram_registered && !ownerLinked && (
        <Card className="mb-6 border-gold/40 bg-gold/5">
          <CardBody className="space-y-2 text-sm text-gold/90">
            <p className="font-semibold">One last tap:</p>
            <p>Open your new bot in Telegram and send <code className="text-gold">/start</code>. This box turns green automatically.</p>
            <p className="text-xs text-zinc-400">{tg.isFetching ? "Checking…" : "Waiting for /start…"}</p>
          </CardBody>
        </Card>
      )}

      {result.bearer_token && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">API / curl token</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="text-xs text-zinc-500">Only needed for scripting/automation. Your normal login is the email + password you chose.</p>
            <CopyRow value={result.bearer_token} />
          </CardBody>
        </Card>
      )}

      <Button onClick={onOpen} className="w-full">Open my dashboard →</Button>
      <p className="mt-4 text-center text-xs text-zinc-500">Then drop a video in your Telegram bot to make your first reel.</p>
    </main>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────────

function Stepper({ current }: { current: Step }) {
  return (
    <div className="mb-8 flex gap-2 text-xs">
      {([1, 2, 3, 4] as Step[]).map((s) => (
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
          {STEP_LABELS[s - 1]}
        </div>
      ))}
    </div>
  );
}

const INPUT_CLS =
  "w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none";

function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`${INPUT_CLS} ${mono ? "font-mono" : ""}`}
    />
  );
}

// Curated fallback for the rare runtime without Intl.supportedValuesOf.
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Mexico_City", "America/Sao_Paulo",
  "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
  "Europe/Rome", "Europe/Amsterdam", "Europe/Athens", "Europe/Moscow",
  "Africa/Cairo", "Africa/Lagos", "Africa/Johannesburg",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Jakarta",
  "Australia/Perth", "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu",
];

const REGION_ORDER = [
  "General", "America", "Europe", "Africa", "Asia",
  "Australia", "Pacific", "Atlantic", "Indian", "Antarctica", "Arctic", "Etc",
];

/** Build the full IANA timezone list (grouped by region) for the dropdown.
 *  Uses Intl.supportedValuesOf where available; always includes UTC + the
 *  caller's current (auto-detected) zone so it's selectable. */
function buildTimezoneGroups(current: string): { label: string; zones: string[] }[] {
  let all: string[];
  try {
    const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    all = typeof fn === "function" ? fn("timeZone") : FALLBACK_ZONES;
  } catch {
    all = FALLBACK_ZONES;
  }
  const zones = new Set(all);
  zones.add("UTC");
  if (current) zones.add(current);

  const byRegion = new Map<string, string[]>();
  for (const z of zones) {
    const region = z.includes("/") ? z.split("/")[0]! : "General";
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(z);
  }
  return [...byRegion.entries()]
    .map(([label, zs]) => ({ label, zones: zs.sort() }))
    .sort((a, b) => {
      const ai = REGION_ORDER.indexOf(a.label);
      const bi = REGION_ORDER.indexOf(b.label);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = useMemo(() => buildTimezoneGroups(value), [value]);
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} appearance-none pr-9 font-mono`}
      >
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">▾</span>
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`${INPUT_CLS} pr-14 font-mono`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-gold"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  how,
  link,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  how?: string[];
  link?: string;
}) {
  return (
    <Field label={label}>
      <SecretInput value={value} onChange={onChange} placeholder={placeholder} />
      {how && <HowTo steps={how} link={link} />}
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-white">{label}</div>
      {hint && <div className="mb-2 text-xs text-zinc-500">{hint}</div>}
      {children}
    </label>
  );
}

function Check({ ok, label, pending }: { ok?: boolean; label: string; pending?: boolean }) {
  const icon = ok ? "✅" : pending ? "⏳" : "⚠️";
  return (
    <div className="flex items-start gap-2">
      <span>{icon}</span>
      <span className={ok ? "text-zinc-200" : "text-zinc-400"}>{label}</span>
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 break-all rounded border border-bg-graphite bg-black px-2 py-1.5 text-xs text-zinc-300">{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        }}
        className="shrink-0 rounded border border-bg-graphite px-3 py-1.5 text-xs text-gold hover:border-gold"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Collapsible "how to get this" helper — plain-English steps, optional link. */
function HowTo({ steps, link }: { steps: string[]; link?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-gold/80 hover:text-gold">
        {open ? "Hide" : "Where do I get this?"}
      </button>
      {open && (
        <div className="mt-2 rounded-card border border-bg-graphite bg-black/40 px-5 py-3 text-xs text-zinc-400">
          <ol className="list-decimal space-y-1">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-gold underline">
              Open →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
