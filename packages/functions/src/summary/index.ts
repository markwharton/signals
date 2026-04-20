import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import { authenticateAdmin, describeAuth } from "../shared/auth.js";
import { buildSummary, parseDays } from "../shared/summaryQuery.js";

app.http("summary", {
  route: "summary",
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

    const site = process.env.SIGNALS_SITE_ID;
    if (!site) {
      ctx.error("summary: SIGNALS_SITE_ID not set");
      return { status: 500 };
    }

    const days = parseDays(req.query.get("days"));
    if (typeof days === "object") {
      return { status: 400, jsonBody: days };
    }

    ctx.log(`summary: ${describeAuth(auth)} days=${days}`);

    const response = await buildSummary(site, days);
    return { status: 200, jsonBody: response };
  },
});
