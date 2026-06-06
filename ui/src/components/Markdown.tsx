"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Renders markdown (bold, italics, lists, headings, links, code, tables) with
 * the app's dark styling. Use for any AI/founder-generated body text — draft
 * captions, SDR drafts, conversation messages, recommendations.
 *
 * Raw HTML in the source is NOT rendered (react-markdown default), so this is
 * XSS-safe for semi-trusted content. Links open in a new tab. Long unbroken
 * tokens (URLs) wrap rather than overflow their container.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`break-words text-sm text-zinc-200 ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-gold underline underline-offset-2 hover:opacity-80"
            />
          ),
          h1: ({ node, ...props }) => (
            <h1 {...props} className="mb-1 mt-3 font-display text-lg text-white first:mt-0" />
          ),
          h2: ({ node, ...props }) => (
            <h2 {...props} className="mb-1 mt-3 font-display text-base text-white first:mt-0" />
          ),
          h3: ({ node, ...props }) => (
            <h3
              {...props}
              className="mb-1 mt-2 font-display text-sm uppercase tracking-widest text-zinc-300 first:mt-0"
            />
          ),
          p: ({ node, ...props }) => (
            <p {...props} className="my-1.5 leading-relaxed first:mt-0 last:mb-0" />
          ),
          ul: ({ node, ...props }) => (
            <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-5" />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-5" />
          ),
          li: ({ node, ...props }) => <li {...props} className="leading-relaxed" />,
          strong: ({ node, ...props }) => (
            <strong {...props} className="font-semibold text-white" />
          ),
          em: ({ node, ...props }) => <em {...props} className="italic" />,
          code: ({ node, ...props }) => (
            <code
              {...props}
              className="rounded bg-bg-charcoal px-1 py-0.5 font-mono text-[0.85em] text-gold"
            />
          ),
          pre: ({ node, ...props }) => (
            <pre
              {...props}
              className="my-2 overflow-x-auto rounded-card border border-bg-graphite bg-bg-deep p-3 text-xs"
            />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="my-2 border-l-2 border-gold/40 pl-3 text-zinc-400" />
          ),
          hr: () => <hr className="my-3 border-bg-graphite" />,
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table {...props} className="w-full border-collapse text-xs" />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th {...props} className="border border-bg-graphite px-2 py-1 text-left text-zinc-300" />
          ),
          td: ({ node, ...props }) => (
            <td {...props} className="border border-bg-graphite px-2 py-1 text-zinc-400" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
