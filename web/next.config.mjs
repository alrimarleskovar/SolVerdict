import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

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

    // --- resolving the parent's own dependencies -----------------------------
    //
    // THE FAILURE THIS FIXES. This is not an npm workspace: the repo root and
    // /web are two independent installs. Vercel's Root Directory is /web, so it
    // clones the whole repo but only runs `npm install` inside /web — the root
    // has source files and no node_modules. `externalDir` happily compiles
    // ../issuance/derive.ts, and then webpack resolves that file's bare imports
    // the way Node would: upward from ITS directory (/issuance/node_modules,
    // /node_modules), which on Vercel does not exist. Build fails with
    // "Can't resolve '@solana/web3.js'" pointing at a file that is not even in
    // /web. Locally it always passed, because the root install is there.
    //
    // WHY A RESOLUTION FALLBACK IS THE RIGHT FIX. The packages are not missing:
    // @solana/web3.js and bs58 are already declared in web/package.json and
    // installed in web/node_modules. Nothing needs to be fetched, vendored or
    // duplicated — resolution simply starts in the wrong place for files above
    // /web. This tells webpack to also look here, which is where the deployed
    // function's node_modules actually is.
    //
    // WHAT WAS REJECTED, AND WHY:
    //   * Vendoring the root modules into /web (the pattern @solverdict/harness
    //     uses) — that exists because the harness is PUBLISHED and must stand
    //     alone at install time. The web app is built from a checkout that
    //     already contains these files. Vendoring would put a second copy of
    //     scoring/ and scenarios/ in the tree, which is precisely the drift this
    //     repo spends several guards preventing.
    //   * Installing the root deps on Vercel too (what the Railway Dockerfile
    //     does) — correct in principle, but it pulls the whole bench toolchain
    //     (solana-agent-kit, three AI SDKs, spl-token) into every web deploy to
    //     satisfy two packages the app already has.
    //
    // Order matters: "node_modules" keeps webpack's normal upward walk first, so
    // local behaviour with a root install present is unchanged; the absolute
    // path is only a fallback.
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.join(WEB_DIR, "node_modules"),
    ];

    return config;
  },
};

export default nextConfig;
