# SolVerdict audit worker (Sprint 5) — always-on Railway service.
#
# The worker (web/worker/run-audit.ts) drains the Supabase queue and, for each
# claimed audit, launches a local Surfpool 1.3.1 surfnet and benches the user's
# HTTPS endpoint. It reuses the PARENT bench (scoring/scenarios/env), so the
# image must contain the whole repo, not just /web.
#
# Build context is the REPO ROOT (see railway.json dockerfilePath). Solana CLI
# is NOT required: Surfpool bundles its own surfnet and the harness drives it
# over RPC via @solana/web3.js (mirrors .github/workflows/smoke.yml, which also
# installs only the Surfpool binary).
FROM node:22-slim

# --- npm 11 (MUST match CI + the lockfile) ---------------------------------
# node:22-slim ships npm 10, but the root package-lock.json is resolved by
# npm 11 (CI pins `npm@11` — see .github/workflows/smoke.yml — because npm 11
# is required to correctly apply the @pump-fun/pump-sdk override). Installing
# under npm 10 makes `npm ci` reject the lockfile as out of sync ("Missing:
# utf-8-validate from lock file"). Pin npm 11 before ANY `npm ci` below.
RUN npm install -g npm@11 && npm --version

# --- OS deps + Surfpool 1.3.1 (pinned) -------------------------------------
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/sp.tgz \
       https://github.com/solana-foundation/surfpool/releases/download/v1.3.1/surfpool-linux-x64.tar.gz \
  && tar xzf /tmp/sp.tgz -C /usr/local/bin \
  && rm /tmp/sp.tgz \
  && surfpool --version

WORKDIR /app

# --- Parent deps first (patch-package postinstall needs patches/) ----------
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci

# --- Web deps (includes tsx, which runs the worker) ------------------------
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --include=dev

# --- Source (node_modules excluded via .dockerignore) ----------------------
COPY . .

# Container-level liveness: the worker touches /tmp/worker-alive every 30s.
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
  CMD test "$(( $(date +%s) - $(stat -c %Y /tmp/worker-alive 2>/dev/null || echo 0) ))" -lt 120 || exit 1

# No ports are exposed — this is a queue consumer, not an HTTP server.
CMD ["npm", "--prefix", "web", "run", "worker"]
