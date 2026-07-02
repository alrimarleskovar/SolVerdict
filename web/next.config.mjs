/** @type {import('next').NextConfig} */
const nextConfig = {
  // The web app lives INSIDE the SolVerdict repo and imports the parent bench's
  // scoring/ and config/ modules via relative paths (../../scoring, ../../config).
  // externalDir lets Next transpile those TypeScript files that sit above /web.
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    // Parent modules use ESM `.js` import specifiers that actually resolve to
    // `.ts` source (moduleResolution: Bundler). Teach webpack the same mapping
    // so `../config/params.js` resolves to params.ts when bundled.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
