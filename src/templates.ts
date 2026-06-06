import slideTitle from "../templates/slide-title.html";
import slideList from "../templates/slide-list.html";
import slideCta from "../templates/slide-cta.html";
import quotePost from "../templates/quote-post.html";
import ytThumbnail from "../templates/yt-thumbnail.html";
import reelCover from "../templates/reel-cover.html";

export type TemplateKey =
  | "slide-title"
  | "slide-list"
  | "slide-cta"
  | "quote-post"
  | "yt-thumbnail"
  | "reel-cover";

const TEMPLATES: Record<TemplateKey, string> = {
  "slide-title": slideTitle,
  "slide-list": slideList,
  "slide-cta": slideCta,
  "quote-post": quotePost,
  "yt-thumbnail": ytThumbnail,
  "reel-cover": reelCover,
};

export function fillTemplate(
  key: TemplateKey,
  vars: Record<string, string>
): string {
  let html = TEMPLATES[key];
  if (!html) throw new Error(`unknown template: ${key}`);

  // Conditional blocks: <!-- IF VAR -->...<!-- END VAR --> survive only when
  // VAR is provided and non-empty. Lets templates show optional sections
  // (photo, bullets, takeaway box) without splitting into N template variants.
  html = html.replace(
    /<!-- IF ([A-Z_]+) -->([\s\S]*?)<!-- END \1 -->/g,
    (_m, varName: string, content: string) => {
      const val = vars[varName];
      return val && val.trim() ? content : "";
    }
  );

  for (const [k, v] of Object.entries(vars)) {
    // Escape HTML, then promote **bold** markdown spans to <b>...</b> so the
    // agent can highlight 2-3 word leads on a bullet without us re-allowing
    // arbitrary HTML through the var substitution boundary.
    const safe = htmlEscape(v).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    html = html.replaceAll(`{{ ${k} }}`, safe);
  }
  // Strip any leftover unreplaced placeholders so they don't render literally.
  html = html.replace(/\{\{\s*[A-Z_]+\s*\}\}/g, "");
  return html;
}

function htmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
