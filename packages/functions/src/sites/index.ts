import type { HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import type { SitesResponse } from "@signals/shared";
import { getAllowedSites } from "../shared/sites.js";

/**
 * GET /api/sites — return the current `SIGNALS_SITES` allowlist.
 *
 * Anonymous: the list of sites this deploy serves is not a secret. The
 * beacon scripts embedded on each tracked site already announce it via
 * the `data-site` attribute, so naming the same set in a server
 * response leaks nothing the public origin doesn't already advertise.
 *
 * The dashboard fetches this on mount to populate the site selector;
 * the sig CLI uses it to validate `--site` against the deploy before
 * issuing a summary request.
 */
app.http("sites", {
  route: "sites",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (): Promise<HttpResponseInit> => {
    const sites = [...getAllowedSites()].sort();
    const body: SitesResponse = { sites };
    return { status: 200, jsonBody: body };
  },
});
