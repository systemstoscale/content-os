"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent phone-first bottom navigation. Renders on every authed dashboard
 * screen so the founder never has to back out to the home page to switch
 * surfaces. Hidden on auth/setup/welcome routes and on wide screens (md+ keeps
 * the on-page nav). Pages add bottom padding via the body rule in globals so
 * content never hides behind the bar.
 */

// Content OS surfaces — Home, Posting, Analytics, Settings.
const TABS = [
  { href: "/", emoji: "🏠", label: "Home", match: (p: string) => p === "/" },
  { href: "/posting/drafts", emoji: "📣", label: "Posting", match: (p: string) => p.startsWith("/posting") },
  { href: "/analytics", emoji: "📊", label: "Analytics", match: (p: string) => p.startsWith("/analytics") },
  { href: "/settings", emoji: "⚙️", label: "Settings", match: (p: string) => p.startsWith("/settings") },
] as const;

const HIDDEN_PREFIXES = ["/login", "/setup", "/welcome"];

export function BottomNav() {
  const pathname = usePathname() || "/";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-bg-graphite bg-bg-deep/95 pb-safe backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-5xl items-stretch justify-between px-1">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-1 text-2xs tracking-wide transition active:scale-95 ${
                  active ? "text-gold" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span
                  className={`flex h-6 w-10 items-center justify-center rounded-full text-base leading-none transition ${
                    active ? "bg-gold/15" : ""
                  }`}
                  aria-hidden
                >
                  {t.emoji}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
