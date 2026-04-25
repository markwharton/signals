import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import { authenticateAdmin, describeAuth } from "../shared/auth.js";
import { isAllowedSite } from "../shared/sites.js";
import { buildSummary, parseDays } from "../shared/summaryQuery.js";

/**
 * GET /api/{site}/summary — return the dashboard summary for `site`
 * over the requested UTC window.
 *
 * `site` is a path parameter, validated against the `SIGNALS_SITES`
 * allowlist. A request for a site outside the allowlist returns 400
 * (not 404) — the route itself matched, only the value is wrong.
 */
app.http("summary", {
  route: "{site}/summary",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext,
  ): Promise<HttpResponseInit> => {
    const auth = authenticateAdmin(req);
    if (!auth) {
      return { status: 401 };
    }

    const site = req.params.site;
    if (!site) {
      return { status: 400, jsonBody: { error: "site path parameter required" } };
    }
    try {
      if (!isAllowedSite(site)) {
        ctx.warn(`summary: site "${site}" not in allowlist`);
        return { status: 400, jsonBody: { error: `unknown site: ${site}` } };
      }
    } catch (err) {
      ctx.error(`summary: ${(err as Error).message}`);
      return { status: 500 };
    }

    const days = parseDays(req.query.get("days"));
    if (typeof days === "object") {
      return { status: 400, jsonBody: days };
    }

    ctx.log(`summary: ${describeAuth(auth)} site=${site} days=${days}`);

    const response = await buildSummary(site, days);
    return { status: 200, jsonBody: response };
  },
});
