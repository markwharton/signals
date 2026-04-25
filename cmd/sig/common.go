package main

import (
	"flag"
	"fmt"

	"github.com/markwharton/signals/internal/apiclient"
	"github.com/markwharton/signals/internal/config"
)

// commonFlags carries the options every sig subcommand accepts.
type commonFlags struct {
	days        string
	includeBots bool
	endpoint    string
	apiKey      string
	site        string
}

// registerCommon wires the five shared flags onto fs. defaultDays
// varies per command ("1" for today, "7" for everything else).
func registerCommon(fs *flag.FlagSet, defaultDays string) *commonFlags {
	f := &commonFlags{}
	fs.StringVar(&f.days, "days", defaultDays,
		"time window in days (integer or \"all\")")
	fs.BoolVar(&f.includeBots, "include-bots", false,
		"include bot counts in aggregate displays")
	fs.StringVar(&f.endpoint, "endpoint", "",
		"api endpoint (overrides config / env)")
	fs.StringVar(&f.apiKey, "api-key", "",
		"api key (overrides config / env)")
	fs.StringVar(&f.site, "site", "",
		"site to summarize, must be in the deploy's SIGNALS_SITES allowlist")
	return f
}

// setup parses the provided args against the shared flag set, loads
// the config, and fetches a Summary. All subcommands start with this
// same five-line preamble.
func setup(name string, args []string, defaultDays string) (*commonFlags, *apiclient.Summary, error) {
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	flags := registerCommon(fs, defaultDays)
	if err := fs.Parse(args); err != nil {
		return nil, nil, err
	}
	cfg, err := config.Load(flags.endpoint, flags.apiKey, flags.site)
	if err != nil {
		return nil, nil, err
	}
	client := apiclient.New(cfg.Endpoint, cfg.APIKey)
	summary, err := client.Summary(cfg.Site, flags.days)
	if err != nil {
		return nil, nil, err
	}
	flags.site = cfg.Site
	return flags, summary, nil
}

// counterTotal returns the pageview + 404 count for the given counter,
// optionally rolling bot traffic in when the user passed --include-bots.
func counterTotal(c apiclient.SummaryCounters, includeBots bool) int {
	t := c.Pageviews + c.NotFounds
	if includeBots {
		t += c.BotPageviews + c.BotNotFounds
	}
	return t
}

// headline renders the site + window line every summary-style
// subcommand prints at the top. With multi-site support the site
// identifier disambiguates output when an operator switches between
// sites in a single shell session.
func headline(site string, s *apiclient.Summary) string {
	if s.Timespan.StartDate == s.Timespan.EndDate {
		return fmt.Sprintf("%s — %s (UTC)", site, s.Timespan.EndDate)
	}
	return fmt.Sprintf("%s — %s to %s (UTC)",
		site, s.Timespan.StartDate, s.Timespan.EndDate)
}
