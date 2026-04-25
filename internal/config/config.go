// Package config loads sig's endpoint + API key from three sources
// with well-defined precedence: flags override env vars override
// a TOML file at the platform's user-config directory.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Config is the loaded endpoint, API key, and target site. All three
// must be non-empty for a request to proceed — `site` selects which
// allowlisted site the read endpoints address.
type Config struct {
	Endpoint string `toml:"endpoint"`
	APIKey   string `toml:"api_key"`
	Site     string `toml:"site"`
}

// ErrMissingConfig signals the caller should emit the first-run
// help text and exit non-zero.
var ErrMissingConfig = errors.New("no signals config found")

// Load reads the config file (if present), overlays env vars, then
// overlays any non-empty flag values. Returns ErrMissingConfig when
// the resulting config is incomplete.
func Load(endpointFlag, apiKeyFlag, siteFlag string) (Config, error) {
	var cfg Config

	if path, err := filePath(); err == nil {
		if _, statErr := os.Stat(path); statErr == nil {
			if _, err := toml.DecodeFile(path, &cfg); err != nil {
				return cfg, fmt.Errorf("reading %s: %w", path, err)
			}
		}
	}

	if v := os.Getenv("SIGNALS_ENDPOINT"); v != "" {
		cfg.Endpoint = v
	}
	if v := os.Getenv("SIGNALS_API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := os.Getenv("SIGNALS_SITE"); v != "" {
		cfg.Site = v
	}

	if endpointFlag != "" {
		cfg.Endpoint = endpointFlag
	}
	if apiKeyFlag != "" {
		cfg.APIKey = apiKeyFlag
	}
	if siteFlag != "" {
		cfg.Site = siteFlag
	}

	if cfg.Endpoint == "" || cfg.APIKey == "" || cfg.Site == "" {
		return cfg, ErrMissingConfig
	}
	return cfg, nil
}

// FilePath returns the resolved config file location (may or may not
// exist on disk). Used by FirstRunMessage so the hint points at the
// right path per-platform.
func FilePath() string {
	if p, err := filePath(); err == nil {
		return p
	}
	return "~/.config/sig/config.toml"
}

func filePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "sig", "config.toml"), nil
}

// FirstRunMessage is the helpful error emitted when Load returns
// ErrMissingConfig. Offers all three configuration paths rather than
// picking one, because first-run users haven't committed to a style.
func FirstRunMessage() string {
	return fmt.Sprintf(`Error: signals config is incomplete.

sig needs an endpoint, an admin API key, and a site (one of the values
in the deploy's SIGNALS_SITES allowlist). Configure by either:
  1. Set environment variables:
       export SIGNALS_ENDPOINT="https://..."
       export SIGNALS_API_KEY="pk_admin_..."
       export SIGNALS_SITE="plankit.com"
  2. Create %s:
       endpoint = "https://..."
       api_key  = "pk_admin_..."
       site     = "plankit.com"
  3. Pass flags:
       sig day --endpoint="https://..." --api-key="pk_admin_..." --site="plankit.com"

Generate an API key with: pnpm run generate:api-key admin <source-name>
(run from the signals repo)
`, FilePath())
}
