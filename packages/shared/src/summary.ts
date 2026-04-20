/**
 * Shape returned by GET /api/summary. Consumed by the dashboard; bot
 * counts ride on every tile so the client-side "show bots" toggle
 * changes only what the UI renders, not what the server fetches. Every
 * counter row carries the same four fields for symmetry across tiles.
 */

export interface SummaryCounters {
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
}

export interface SummaryResponse {
  /** UTC window the counters cover. `startDate` and `endDate` are
   *  inclusive YYYY-MM-DD strings; `days` is the requested span. */
  timespan: {
    days: number;
    startDate: string;
    endDate: string;
  };
  totals: SummaryCounters;
  /** One entry per UTC day in the timespan, ordered oldest-first, for
   *  driving the pageviews sparkline. */
  sparkline: Array<{ date: string } & SummaryCounters>;
  topPaths: Array<{ path: string } & SummaryCounters>;
  topReferrers: Array<{ referrerHost: string } & SummaryCounters>;
  /** Paths that 404'd at least once in the window, sorted by notFounds. */
  topBrokenPaths: Array<{
    path: string;
    notFounds: number;
    botNotFounds: number;
  }>;
  device: {
    mobile: number;
    desktop: number;
    botMobile: number;
    botDesktop: number;
  };
}
