// SPDX-License-Identifier: Apache-2.0
/**
 * SSRF / abuse guard for outbound audit requests.
 *
 * The worker sends scenario payloads to an ARBITRARY user-supplied URL. Without
 * guarding, that turns SolVerdict into an SSRF probe / request amplifier. This
 * module is the single chokepoint every outbound target must pass:
 *   - HTTPS only (no http, file, gopher, …);
 *   - no embedded credentials;
 *   - the hostname must resolve ONLY to public unicast IPs — any loopback,
 *     private, link-local, CGNAT, multicast or reserved address is rejected.
 *
 * It is enforced at BOTH submit time (before enqueue) and request time in the
 * worker (defense against DNS rebinding between submit and run).
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** True for any IPv4 literal that must never be dialed from the worker. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (test-net)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 test-net
  if (a === 203 && b === 0) return true; // 203.0.113/24 test-net
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

/** True for any IPv6 literal (incl. IPv4-mapped) that must never be dialed. */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  // IPv4-mapped / -compatible (::ffff:1.2.3.4 or ::ffff:0:0/96) → check the v4.
  const mapped = addr.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const first = addr.split(":")[0] ?? "";
  const hi = parseInt(first || "0", 16);
  if (Number.isNaN(hi)) return true;
  if ((hi & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((hi & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hi & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True if `ip` (v4 or v6 literal) is not a safe public unicast address. */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP literal → unsafe
}

/**
 * Cheap synchronous hostname screen for the submit form (no DNS). Rejects the
 * obvious cases before the async check runs. NOT a substitute for
 * assertPublicHttpsUrl — DNS resolution is where the real check happens.
 */
export function looksLikePrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (net.isIP(h) && isPrivateIp(h)) return true;
  // bracketed IPv6 literal, e.g. [::1]
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    if (net.isIP(inner) && isPrivateIp(inner)) return true;
  }
  return false;
}

export interface SafeTarget {
  hostname: string;
  addresses: string[];
}

/**
 * Full guard: parse, require HTTPS + no credentials, resolve DNS, and reject if
 * ANY resolved address is non-public. Returns the resolved public addresses so
 * callers may pin to them. Throws SsrfError on any violation.
 */
export async function assertPublicHttpsUrl(rawUrl: string): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("URL is not parseable");
  }
  if (url.protocol !== "https:") {
    throw new SsrfError("endpoint must use https");
  }
  if (url.username || url.password) {
    throw new SsrfError("endpoint must not contain credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new SsrfError("endpoint has no host");
  }
  if (looksLikePrivateHostname(url.hostname)) {
    throw new SsrfError(`endpoint host ${url.hostname} is not publicly routable`);
  }

  // If the host is a literal IP, we already screened it above; still confirm.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new SsrfError(`endpoint IP ${hostname} is not publicly routable`);
    return { hostname, addresses: [hostname] };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfError(`could not resolve ${hostname}`);
  }
  if (records.length === 0) {
    throw new SsrfError(`${hostname} did not resolve to any address`);
  }
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      throw new SsrfError(`${hostname} resolves to non-public address ${rec.address}`);
    }
  }
  return { hostname, addresses: records.map((r) => r.address) };
}
