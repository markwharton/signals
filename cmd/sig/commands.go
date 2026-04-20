package main

import (
	"fmt"
	"os"

	"github.com/markwharton/signals/internal/apiclient"
	"github.com/markwharton/signals/internal/render"
)

// cmdToday and cmdWeek both render the full summary; they differ
// only in default window. Today omits the sparkline (it'd be a
// single bar) but is otherwise identical to week.
func cmdToday(args []string) error {
	flags, summary, err := setup("today", args, "1")
	if err != nil {
		return err
	}
	renderSummary(summary, flags.includeBots, false /* no sparkline */)
	return nil
}

func cmdWeek(args []string) error {
	flags, summary, err := setup("week", args, "7")
	if err != nil {
		return err
	}
	renderSummary(summary, flags.includeBots, true /* sparkline */)
	return nil
}

func cmdPaths(args []string) error {
	flags, summary, err := setup("paths", args, "7")
	if err != nil {
		return err
	}
	fmt.Println(headline(summary))
	fmt.Println()
	renderPaths(summary.TopPaths, flags.includeBots)
	return nil
}

func cmdReferrers(args []string) error {
	flags, summary, err := setup("referrers", args, "7")
	if err != nil {
		return err
	}
	fmt.Println(headline(summary))
	fmt.Println()
	renderReferrers(summary.TopReferrers, flags.includeBots)
	return nil
}

func cmdBroken(args []string) error {
	_, summary, err := setup("404s", args, "7")
	if err != nil {
		return err
	}
	fmt.Println(headline(summary))
	fmt.Println()
	renderBroken(summary.TopBrokenPaths)
	return nil
}

func cmdDevice(args []string) error {
	flags, summary, err := setup("device", args, "7")
	if err != nil {
		return err
	}
	fmt.Println(headline(summary))
	fmt.Println()
	renderDevice(summary.Device, flags.includeBots)
	return nil
}

func cmdBots(args []string) error {
	_, summary, err := setup("bots", args, "7")
	if err != nil {
		return err
	}
	fmt.Println(headline(summary))
	fmt.Println()
	renderBots(summary.Totals)
	return nil
}

// --- renderers ---------------------------------------------------------------

func renderSummary(s *apiclient.Summary, includeBots, sparkline bool) {
	fmt.Println(headline(s))
	fmt.Println()

	pv := s.Totals.Pageviews
	nf := s.Totals.NotFounds
	if includeBots {
		pv += s.Totals.BotPageviews
		nf += s.Totals.BotNotFounds
	}
	fmt.Printf("Pageviews: %s", render.Count(pv))
	if !includeBots && s.Totals.BotPageviews > 0 {
		fmt.Printf(" (+%s bot)", render.Count(s.Totals.BotPageviews))
	}
	fmt.Println()
	fmt.Printf("404s: %s", render.Count(nf))
	if !includeBots && s.Totals.BotNotFounds > 0 {
		fmt.Printf(" (+%s bot)", render.Count(s.Totals.BotNotFounds))
	}
	fmt.Println()

	if sparkline && len(s.Sparkline) > 0 {
		data := make([]int, 0, len(s.Sparkline))
		for _, e := range s.Sparkline {
			v := e.Pageviews + e.NotFounds
			if includeBots {
				v += e.BotPageviews + e.BotNotFounds
			}
			data = append(data, v)
		}
		fmt.Printf("Trend:     %s\n", render.Sparkline(data))
	}

	if len(s.TopPaths) > 0 {
		fmt.Println()
		fmt.Println("Top paths:")
		renderPaths(s.TopPaths, includeBots)
	}
	if len(s.TopReferrers) > 0 {
		fmt.Println()
		fmt.Println("Top referrers:")
		renderReferrers(s.TopReferrers, includeBots)
	}
	if len(s.TopBrokenPaths) > 0 {
		fmt.Println()
		fmt.Println("Broken paths:")
		renderBroken(s.TopBrokenPaths)
	}
	fmt.Println()
	renderDevice(s.Device, includeBots)
}

func renderPaths(paths []apiclient.PathEntry, includeBots bool) {
	if len(paths) == 0 {
		fmt.Println("  (none)")
		return
	}
	rows := make([][]string, 0, len(paths))
	for _, p := range paths {
		n := p.Pageviews
		if includeBots {
			n += p.BotPageviews
		}
		line := []string{"  " + p.Path, render.Count(n)}
		if !includeBots && p.BotPageviews > 0 {
			line = append(line, fmt.Sprintf("(+%s bot)", render.Count(p.BotPageviews)))
		}
		rows = append(rows, line)
	}
	render.Table(os.Stdout, rows)
}

func renderReferrers(refs []apiclient.ReferrerEntry, includeBots bool) {
	if len(refs) == 0 {
		fmt.Println("  (none)")
		return
	}
	rows := make([][]string, 0, len(refs))
	for _, r := range refs {
		n := r.Pageviews
		if includeBots {
			n += r.BotPageviews
		}
		line := []string{"  " + r.ReferrerHost, render.Count(n)}
		if !includeBots && r.BotPageviews > 0 {
			line = append(line, fmt.Sprintf("(+%s bot)", render.Count(r.BotPageviews)))
		}
		rows = append(rows, line)
	}
	render.Table(os.Stdout, rows)
}

func renderBroken(paths []apiclient.BrokenEntry) {
	if len(paths) == 0 {
		fmt.Println("  (no 404s in this window)")
		return
	}
	rows := make([][]string, 0, len(paths))
	for _, p := range paths {
		total := p.NotFounds + p.BotNotFounds
		rows = append(rows, []string{"  " + p.Path, render.Count(total)})
	}
	render.Table(os.Stdout, rows)
}

func renderDevice(d apiclient.Device, includeBots bool) {
	desktop := d.Desktop
	mobile := d.Mobile
	if includeBots {
		desktop += d.BotDesktop
		mobile += d.BotMobile
	}
	total := desktop + mobile
	fmt.Printf("Device:  Desktop %s (%s)  |  Mobile %s (%s)\n",
		render.Count(desktop), render.Percent(desktop, total),
		render.Count(mobile), render.Percent(mobile, total))
}

func renderBots(totals apiclient.SummaryCounters) {
	bot := totals.BotPageviews + totals.BotNotFounds
	human := totals.Pageviews + totals.NotFounds
	grand := bot + human
	fmt.Printf("Total events:     %s\n", render.Count(grand))
	fmt.Printf("Human traffic:    %s (%s)\n",
		render.Count(human), render.Percent(human, grand))
	fmt.Printf("Filtered bots:    %s (%s)\n",
		render.Count(bot), render.Percent(bot, grand))
	if bot > 0 {
		fmt.Println()
		fmt.Println("Bot breakdown:")
		fmt.Printf("  Pageviews:      %s\n", render.Count(totals.BotPageviews))
		fmt.Printf("  404s:           %s\n", render.Count(totals.BotNotFounds))
	}
}
