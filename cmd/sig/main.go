// Command sig — terminal-flavored signals reader.
//
// Seven subcommands, one for each dashboard tile plus compact
// "sig day" / "sig week" summary views:
//
//   sig day         compact view of the most recent complete UTC day
//   sig week        last 7 days with sparkline
//   sig paths       top paths ranking
//   sig referrers   top referrers ranking
//   sig 404s        broken paths (by notFounds)
//   sig device      mobile/desktop split
//   sig bots        bot filtering summary
//
// Every subcommand accepts --days to override the default window
// and --include-bots to fold bot counts into human aggregates (the
// default shows human-only, matching the dashboard's default).
package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/markwharton/signals/internal/config"
	"github.com/markwharton/signals/internal/version"
)

const usage = `sig — query signals from the terminal

Commands:
  day               compact view of the most recent complete UTC day
  week              last 7 days with sparkline
  paths             top paths ranking
  referrers         top referrers ranking
  404s              broken paths (by notFounds)
  device            mobile/desktop split
  bots              bot filtering summary

Flags (any command):
  --days N          window in days (7, 30, all) — overrides default
  --include-bots    include bot counts in aggregate displays
  --endpoint URL    api endpoint (overrides config / env)
  --api-key KEY     api key (overrides config / env)
  --help, -h        show this help

Configuration precedence: flags > env vars > config file.
  SIGNALS_ENDPOINT, SIGNALS_API_KEY env vars.
  Config file (platform-native via os.UserConfigDir):
    macOS:   ~/Library/Application Support/sig/config.toml
    Linux:   ~/.config/sig/config.toml
    Windows: %AppData%\sig\config.toml
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "-h", "--help", "help":
		fmt.Print(usage)
		return
	case "-v", "--version", "version":
		fmt.Println(version.Version())
		return
	case "day":
		run(cmdDay, args)
	case "week":
		run(cmdWeek, args)
	case "paths":
		run(cmdPaths, args)
	case "referrers":
		run(cmdReferrers, args)
	case "404s":
		run(cmdBroken, args)
	case "device":
		run(cmdDevice, args)
	case "bots":
		run(cmdBots, args)
	default:
		fmt.Fprintf(os.Stderr, "sig: unknown command %q\n\n%s", cmd, usage)
		os.Exit(2)
	}
}

func run(fn func([]string) error, args []string) {
	if err := fn(args); err != nil {
		if errors.Is(err, config.ErrMissingConfig) {
			fmt.Fprint(os.Stderr, config.FirstRunMessage())
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "sig: %v\n", err)
		os.Exit(1)
	}
}
