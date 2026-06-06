"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { PageLayout } from "@/components/ui/page-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loading, Empty } from "@/components/ui/states";
import { Markdown } from "@/components/Markdown";

interface ReviewResponse {
  ok: boolean;
  top: string[];
  takeaways: string;
  generated: boolean;
}

export default function ContentReview() {
  const authed = useRequireAuth();
  const review = useQuery<ReviewResponse>({
    queryKey: ["content-review"],
    queryFn: () => api.get("/api/posting/review"),
    enabled: authed === true,
    staleTime: 60 * 60 * 1000, // an hour — this is a weekly-cadence digest
  });

  if (!authed) return null;

  return (
    <PageLayout
      crumbs={[{ label: "Home", href: "/" }, { label: "Posting", href: "/posting/drafts" }, { label: "Review" }]}
      back={{ href: "/posting/drafts", label: "Drafts" }}
      title="📊 What's Working"
      subtitle="Your best posts by engagement, with the patterns to repeat. Refreshes from Zernio analytics."
      maxWidth="3xl"
      actions={
        <Link href="/posting/ideas">
          <Button variant="secondary">💡 Turn into ideas →</Button>
        </Link>
      }
    >
      {review.isLoading && <Loading label="Reviewing your top posts…" />}

      {review.data && !review.data.generated && review.data.top.length === 0 && (
        <Empty
          icon="📈"
          title="No performance data yet"
          hint={review.data.takeaways}
          action={
            <Link href="/posting/new">
              <Button>Draft your first post →</Button>
            </Link>
          }
        />
      )}

      {review.data && review.data.takeaways && (review.data.generated || review.data.top.length > 0) && (
        <Card className="mb-6 p-5">
          <Markdown>{review.data.takeaways}</Markdown>
        </Card>
      )}

      {review.data && review.data.top.length > 0 && (
        <section>
          <h2 className="mb-2 text-2xs uppercase tracking-widest text-zinc-500">Top posts</h2>
          <ul className="space-y-2">
            {review.data.top.map((t, i) => (
              <li
                key={i}
                className="rounded-card border border-bg-graphite bg-bg-ink p-3 text-sm text-zinc-300"
              >
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageLayout>
  );
}
