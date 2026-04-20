// Package render holds tiny presentation helpers shared across sig
// subcommands: compact number formatting, unicode sparklines, and a
// couple of table primitives. No third-party deps — text/tabwriter
// from the stdlib handles aligned tables.
package render

import (
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
)

// Count formats an integer for tile-like display. Mirrors the
// dashboard's formatter: full number with locale grouping below
// 10,000; compact "1.2K" / "3.4M" above that.
func Count(n int) string {
	if n < 10_000 {
		return commaGroup(n)
	}
	if n < 1_000_000 {
		return fmt.Sprintf("%.1fK", float64(n)/1000)
	}
	return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
}

// Percent formats a fraction (0..100) as "23%" with no decimals,
// matching the dashboard's device tile rendering.
func Percent(part, total int) string {
	if total <= 0 {
		return "0%"
	}
	return fmt.Sprintf("%d%%", int(float64(part)*100/float64(total)+0.5))
}

// Sparkline renders a slice of counts as a unicode sparkline of the
// same length. Matches the dashboard's SVG polyline visually at
// lower fidelity (8 levels instead of pixel-smooth).
func Sparkline(data []int) string {
	if len(data) == 0 {
		return ""
	}
	bars := []rune("▁▂▃▄▅▆▇█")
	max := 0
	for _, v := range data {
		if v > max {
			max = v
		}
	}
	var b strings.Builder
	b.Grow(len(data) * 3) // UTF-8 expansion
	for _, v := range data {
		if max == 0 {
			b.WriteRune(bars[0])
			continue
		}
		idx := int(float64(v) / float64(max) * float64(len(bars)-1))
		if idx < 0 {
			idx = 0
		}
		if idx >= len(bars) {
			idx = len(bars) - 1
		}
		b.WriteRune(bars[idx])
	}
	return b.String()
}

// Table writes tab-separated lines (\t between columns) to w, padded
// into aligned columns. Caller provides rows already formatted —
// Table just handles alignment.
func Table(w io.Writer, rows [][]string) {
	tw := tabwriter.NewWriter(w, 0, 2, 2, ' ', 0)
	for _, row := range rows {
		fmt.Fprintln(tw, strings.Join(row, "\t"))
	}
	_ = tw.Flush()
}

func commaGroup(n int) string {
	if n < 0 {
		return "-" + commaGroup(-n)
	}
	if n < 1000 {
		return fmt.Sprintf("%d", n)
	}
	return commaGroup(n/1000) + "," + fmt.Sprintf("%03d", n%1000)
}
