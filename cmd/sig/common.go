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
}

// registerCommon wires the four shared flags onto fs. defaultDays
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
	cfg, err := config.Load(flags.endpoint, flags.apiKey)
	if err != nil {
		return nil, nil, err
	}
	client := apiclient.New(cfg.Endpoint, cfg.APIKey)
	summary, err := client.Summary(flags.days)
	if err != nil {
		return nil, nil, err
	}
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

// headline renders the window line every summary-style subcommand
// prints at the top. signals is single-tenant, so the site identifier
// isn't useful; callers know which site they configured.
func headline(s *apiclient.Summary) string {
	if s.Timespan.StartDate == s.Timespan.EndDate {
		return fmt.Sprintf("%s (UTC)", s.Timespan.EndDate)
	}
	return fmt.Sprintf("%s to %s (UTC)",
		s.Timespan.StartDate, s.Timespan.EndDate)
}
