// Counter-mode pageview beacon for signals.
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
// Privacy envelope: no cookies, no IPs, no fingerprints, no sessions,
// no raw user-agent, no referrer query strings. The payload includes
// only the fields the privacy policy enumerates.
//
// No imports by design — tsc emits a self-contained <script>-safe file.
// The payload shape mirrors CollectRequest in @signals/shared; the server
// validates on receipt, so a drift surfaces as a rejected request.

interface CollectPayload {
  v: 1;
  kind: "pageview";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
}

(function signalsBeacon(): void {
  const scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) return;

  const site = scriptEl.getAttribute("data-site");
  if (!site) return;

  const mode = scriptEl.getAttribute("data-mode") ?? "counter";
  if (mode !== "counter") return;

  const endpoint = resolveEndpoint(scriptEl);
  if (!endpoint) return;

  const payload: CollectPayload = {
    v: 1,
    kind: "pageview",
    site,
    path: location.pathname,
    referrerHost: computeReferrerHost(document.referrer, location.hostname),
    isMobile: detectMobile(),
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
