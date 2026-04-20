// Counter-mode beacon for signals.
//
// Runs as a classic browser script embedded via:
//   <script
//     src="https://{swa}/beacon.js"
//     data-site="plankit.com"
//     data-endpoint="https://{funcapp}.azurewebsites.net/api/collect">
//   </script>
//
// data-endpoint is required when the beacon script origin differs from the
// API origin — which is the normal case once signals runs on a dedicated
// Function App. It falls back to deriving `{script-origin}/api/collect` so
// same-origin setups (local SWA CLI emulator, or a future reverse-proxy
// deployment) still work without the explicit attribute.
//
// data-kind defaults to "pageview". Set `data-kind="404"` on the site's
// 404.html (only) so soft-404 views — GitHub Pages and similar static
// hosts leave the attempted path in the URL bar — are distinguishable
// from real pageviews in rollups. Unknown values warn and fall back to
// pageview; a fire-and-forget beacon should fail soft.
//
// Privacy envelope: no cookies, no IPs, no fingerprints, no sessions,
// no raw user-agent, no referrer query strings. The payload includes
// only the fields the privacy policy enumerates. Bot classification is
// done client-side via isbot; only the derived boolean crosses the wire.
//
// Built by esbuild as a single IIFE so the output is safe to embed in a
// plain <script> tag without type="module". isbot is inlined by the
// bundler; the `import { isbot }` below resolves at build time. The
// payload shape mirrors CollectRequest in @signals/shared; the server
// validates on receipt, so a drift surfaces as a rejected request.

import { isbot } from "isbot";

interface CollectPayload {
  v: 1;
  kind: "pageview" | "404";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
  isBot: boolean;
}

(function signalsBeacon(): void {
  const scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) return;

  const site = scriptEl.getAttribute("data-site");
  if (!site) return;

  const mode = scriptEl.getAttribute("data-mode") ?? "counter";
  if (mode !== "counter") return;

  const kind = resolveKind(scriptEl);

  const endpoint = resolveEndpoint(scriptEl);
  if (!endpoint) return;

  const payload: CollectPayload = {
    v: 1,
    kind,
    site,
    path: location.pathname,
    referrerHost: computeReferrerHost(document.referrer, location.hostname),
    isMobile: detectMobile(),
    isBot: detectBot(),
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, blob);
  } else {
    fetch(endpoint, { method: "POST", body: blob, keepalive: true }).catch(
      () => {
        /* best effort; page may be unloading */
      },
    );
  }
})();

function resolveKind(scriptEl: HTMLScriptElement): "pageview" | "404" {
  const attr = scriptEl.getAttribute("data-kind") ?? "pageview";
  if (attr === "pageview" || attr === "404") return attr;
  console.warn(
    `signals beacon: unknown data-kind "${attr}", defaulting to pageview`,
  );
  return "pageview";
}

function resolveEndpoint(scriptEl: HTMLScriptElement): string | null {
  const explicit = scriptEl.getAttribute("data-endpoint");
  if (explicit) return explicit;
  try {
    return `${new URL(scriptEl.src).origin}/api/collect`;
  } catch {
    return null;
  }
}

function computeReferrerHost(
  referrer: string,
  currentHostname: string,
): string | null {
  // Same-origin → null is intentional: a site-to-site click would otherwise
  // inflate the site's own referrer counts with itself, which is accurate but
  // not actionable for OSS marketing attribution. This, plus empty referrer,
  // both map to null; rollups may want to distinguish typed-URL from
  // referrer-stripped traffic later, which would require a new wire-format
  // field rather than a data-only change.
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.hostname === currentHostname) return null;
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

function detectBot(): boolean {
  return isbot(navigator.userAgent);
}

function detectMobile(): boolean {
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { mobile?: boolean };
    }
  ).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile;
  }
  return /Mobile|Android|iPhone|iPod/i.test(navigator.userAgent);
}
