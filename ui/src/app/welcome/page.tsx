"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMe } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Welcome() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then((me) => {
      if (!me) router.replace("/login");
      else setEmail(me.email);
    });
  }, [router]);

  if (email === null) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
        <h1 className="font-display text-3xl sm:text-4xl">Welcome to Content OS</h1>
        <p className="mt-3 text-sm text-zinc-400 sm:text-base">
          Hey {email.split("@")[0]} — your install is live. Here's the 60-second
          orientation so you know what this system does and where to find
          things.
        </p>
      </header>

      <section className="mb-10 space-y-4">
        <Step
          n={1}
          title="Content runs on autopilot"
          body="Every morning at 7am UTC the agent generates a content brief based on your pillars + recent activity. You also get drafts from any voice note or message you send to the Telegram bot, or from the New-brief form in this UI."
        />
        <Step
          n={2}
          title="Drafts wait for your approval"
          body="When a draft is ready, you'll get an email and a Telegram DM with [✓ Approve] [✗ Reject] [🚀 Publish now] buttons. Tap from your phone, or open /posting/drafts here. Nothing publishes without your tap — period."
        />
        <Step
          n={3}
          title="Reels render + queue themselves"
          body="Talking-head and avatar reels are cut, captioned, and rendered in the background, then queued to publish at your reel hour. You approve each one from Telegram or /posting/drafts before it goes live."
        />
        <Step
          n={4}
          title="Check health + bindings at /settings/health"
          body="Bindings, CONFIG values, and recent agent activity. If something looks off, this is your first stop."
        />
      </section>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Jump to a surface
          </h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <NavLink href="/posting/drafts" title="Posting · Drafts" sub="Browse, approve, reject" />
          <NavLink href="/posting/new" title="Posting · New brief" sub="Generate a draft from a prompt" />
          <NavLink href="/posting/ideas" title="Posting · Ideas" sub="Your content idea bank" />
          <NavLink href="/analytics" title="Analytics" sub="How your published content performs" />
          <NavLink href="/settings/brand" title="Settings · Brand" sub="Voice + visual guidelines" />
          <NavLink href="/settings/health" title="Settings · Health" sub="Bindings + sessions log" />
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/" className="flex-1">
          <Button className="w-full">Take me to the dashboard</Button>
        </Link>
        <Link href="/posting/new" className="flex-1">
          <Button variant="secondary" className="w-full">
            Create my first draft
          </Button>
        </Link>
      </div>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-4 rounded-card border border-bg-graphite bg-bg-ink p-4 sm:p-5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/60 text-sm font-display text-gold">
        {n}
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-sm sm:text-base">{title}</h3>
        <p className="mt-1 text-xs text-zinc-400 sm:text-sm">{body}</p>
      </div>
    </div>
  );
}

function NavLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="rounded-card border border-bg-graphite bg-bg-charcoal p-3 transition hover:border-gold/60"
    >
      <div className="font-display text-xs text-white">{title}</div>
      <div className="mt-1 text-2xs text-zinc-500">{sub}</div>
    </Link>
  );
}
