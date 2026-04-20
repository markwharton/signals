import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import { validateApiKey } from "../shared/apiKey.js";
import { ALL_DAYS, buildSummary } from "../shared/summaryQuery.js";

/**
 * Model Context Protocol endpoint for signals.
 *
 * POST /api/mcp
 * Auth: `x-api-key: pk_mcp_*` validated against MCP_API_KEYS.
 * Transport: Streamable HTTP, stateless JSON mode. Mirrors the
 * pattern used in HeliMods' onsite-monitor so Claude Desktop and
 * mcp-bridge can consume signals without any new transport work on
 * their side.
 *
 * Tools (read-only):
 *   - signals_summary(days: 7|30|"all") — returns the same
 *     SummaryResponse the dashboard renders. Claude can then answer
 *     questions like "what are the top paths" or "how much bot
 *     traffic did we see" from the JSON.
 *
 * The MCP SDK is dynamically imported to keep its dependency graph
 * (zod + zod-to-json-schema) off the main compilation path.
 */

function jsonRpcError(
  code: number,
  message: string,
  id: unknown = null,
): HttpResponseInit {
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: { jsonrpc: "2.0", error: { code, message }, id },
  };
}

app.http("mcp", {
  route: "mcp",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext,
  ): Promise<HttpResponseInit> => {
    const site = process.env.SIGNALS_SITE_ID;
    if (!site) {
      ctx.error("mcp: SIGNALS_SITE_ID not set");
      return jsonRpcError(-32603, "Server not configured");
    }

    const sourceId = validateApiKey(
      "MCP_API_KEYS",
      req.headers.get("x-api-key"),
    );
    if (!sourceId) {
      return jsonRpcError(-32001, "Unauthorized: invalid or missing API key");
    }

    try {
      const { McpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
      );
      const { WebStandardStreamableHTTPServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
      );
      const { z } = await import("zod");

      const server = new McpServer(
        { name: "signals", version: "0.4.0" },
        { capabilities: { tools: {} } },
      );

      server.registerTool(
        "signals_summary",
        {
          description:
            "Aggregate pageview and 404 counts for the tracked site over a " +
            "UTC time window, broken down by path, referrer, and device. " +
            "Includes bot traffic as separate fields so callers can " +
            "distinguish human from automated traffic.",
          inputSchema: {
            days: z
              .union([z.number().int().min(1).max(365), z.literal("all")])
              .optional()
              .describe(
                "Length of the window in UTC days (integer 1-365), or " +
                  "'all' for the maximum server-capped window (365 days). " +
                  "Defaults to 7.",
              ),
          },
        },
        async ({ days }: { days?: number | "all" }) => {
          const resolved = days === "all" ? ALL_DAYS : (days ?? 7);
          const summary = await buildSummary(site, resolved);
          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          };
        },
      );

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      await server.connect(transport);

      const body = await req.text();
      const url = new URL(req.url);
      const headers = new Headers();
      for (const [key, value] of req.headers.entries()) {
        if (value) headers.set(key, value);
      }
      // MCP SDK requires this Accept header; injected regardless of what the
      // client sent so mcp-bridge and raw curl both work.
      headers.set("Accept", "application/json, text/event-stream");
      headers.set("Content-Type", "application/json");

      const webRequest = new Request(url.toString(), {
        method: "POST",
        headers,
        body,
      });

      const webResponse = await transport.handleRequest(webRequest);
      const responseBody = await webResponse.text();
      const responseHeaders: Record<string, string> = {};
      webResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      await server.close();

      ctx.log(`mcp: ${sourceId} ${req.method} → ${webResponse.status}`);

      return {
        status: webResponse.status,
        headers: responseHeaders,
        body: responseBody,
      };
    } catch (err) {
      ctx.error("mcp: handler failed", err);
      return jsonRpcError(-32603, "Internal error");
    }
  },
});
