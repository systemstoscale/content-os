/**
 * Flatten markdown to clean single-line plain text for PREVIEW contexts
 * (list rows, today cards, anything line-clamped) so raw `**`, `#`, links,
 * and bullets never leak into a compact preview. Use <Markdown> for full
 * rendering in detail views.
 */
export function stripMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italics
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/^\s*\d+\.\s+/gm, "") // numbered lists
    .replace(/\s+/g, " ") // collapse whitespace + newlines
    .trim();
}
