// Package apiclient is sig's HTTP client for signals' /api/summary
// endpoint. Mirrors the SummaryResponse shape declared in
// packages/shared/src/summary.ts so the CLI's tile data matches
// whatever the dashboard sees.
package apiclient

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SummaryCounters carries the four-way split every rollup row
// exposes: non-bot pageviews and 404s, and the bot-flagged versions
// of each.
type SummaryCounters struct {
	Pageviews    int `json:"pageviews"`
	NotFounds    int `json:"notFounds"`
	BotPageviews int `json:"botPageviews"`
	BotNotFounds int `json:"botNotFounds"`
}

type Timespan struct {
	Days      int    `json:"days"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type SparklineEntry struct {
	Date string `json:"date"`
	SummaryCounters
}

type PathEntry struct {
	Path string `json:"path"`
	SummaryCounters
}

type ReferrerEntry struct {
	ReferrerHost string `json:"referrerHost"`
	SummaryCounters
}

type BrokenEntry struct {
	Path         string `json:"path"`
	NotFounds    int    `json:"notFounds"`
	BotNotFounds int    `json:"botNotFounds"`
}

type Device struct {
	Mobile     int `json:"mobile"`
	Desktop    int `json:"desktop"`
	BotMobile  int `json:"botMobile"`
	BotDesktop int `json:"botDesktop"`
}

// Summary is the full /api/summary response. One fetch drives every
// sig subcommand — same shape the dashboard uses.
type Summary struct {
	Timespan       Timespan         `json:"timespan"`
	Totals         SummaryCounters  `json:"totals"`
	Sparkline      []SparklineEntry `json:"sparkline"`
	TopPaths       []PathEntry      `json:"topPaths"`
	TopReferrers   []ReferrerEntry  `json:"topReferrers"`
	TopBrokenPaths []BrokenEntry    `json:"topBrokenPaths"`
	Device         Device           `json:"device"`
}

type Client struct {
	Endpoint string
	APIKey   string
	HTTP     *http.Client
}

func New(endpoint, apiKey string) *Client {
	return &Client{
		Endpoint: strings.TrimRight(endpoint, "/"),
		APIKey:   apiKey,
		HTTP:     &http.Client{Timeout: 30 * time.Second},
	}
}

// Summary calls GET /api/summary?days=<days>. `days` accepts "7",
// "30", or "all" (server-enforced).
func (c *Client) Summary(days string) (*Summary, error) {
	url := fmt.Sprintf("%s/api/summary?days=%s", c.Endpoint, days)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("api %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var summary Summary
	if err := json.Unmarshal(body, &summary); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return &summary, nil
}
