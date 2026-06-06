/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output a fully static site to ./out/ — served by Cloudflare Workers
  // Assets (see ../wrangler.toml [[assets]] binding). No Node runtime,
  // no Server Components, no API routes. The Worker is the API.
  output: "export",

  // Workers Assets serves files as-is; trailing slashes break our routing,
  // so disable Next's directory-style URLs and emit clean .html files.
  trailingSlash: false,

  // The Cloudflare Worker proxies any /r2/* request to R2, so we don't
  // want Next's image optimizer in the way.
  images: { unoptimized: true },

  // Aggressive cache invalidation: production assets are content-hashed by
  // Next, but having the build-id in the path gives us atomic rollback if
  // a deploy goes sideways.
  generateBuildId: () => process.env.BUILD_ID ?? `local-${Date.now()}`,

  // Same set of "modern target" features as the parent skalers/frontend.
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
