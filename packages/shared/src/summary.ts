/**
 * Shape returned by GET /api/summary. Consumed by the dashboard; bot
 * counts ride on every tile so the client-side "show bots" toggle
 * changes only what the UI renders, not what the server fetches. Every
 * counter row carries the same four core fields for symmetry across
 * tiles.
 *
 * Signal-mode deploys additionally populate `visitors`, `sessions`, and
 * `bounces` on `totals`, `sparkline` entries, and the new `countries`
 * array. Counter-mode deploys leave those three fields undefined; the
 * dashboard gates the new tiles on `totals.sessions > 0` so counter
 * deploys render the same layout they did before signal mode existed.
 */

export interface SummaryCounters {
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
  visitors?: number;
  sessions?: number;
  bounces?: number;
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
  /** Signal-mode only. Top countries in the window by pageview count,
   *  each carrying the full counter set. Absent on counter-mode deploys
   *  where the `country` rollup rows are empty. */
  topCountries?: Array<{ country: string } & SummaryCounters>;
}
