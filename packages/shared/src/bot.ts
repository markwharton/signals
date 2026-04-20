// Bot detection for signals event collection.
//
// Uses the isbot library (Unlicense / public domain) rather than maintaining
// an inline regex. isbot's curated pattern handles known false-positive
// classes that bite naive regex implementations:
//
//   - Cubot devices: UA contains "Cubot" — naive /bot/ flags as bot
//   - Boto/Botocore (AWS SDK): UA contains "Boto" — naive /bot/ flags as bot
//   - Various legitimate browser product names containing "robotic" etc.
//
// AUDIT TRADEOFF: This boolean lets us count bot traffic without storing
// the user-agent string (preserving the privacy envelope). Cost: if bot
// counts spike unexpectedly, we can see that something changed but cannot
// review which UAs got flagged. To investigate, temporarily extend the
// event schema to capture UA-of-bot-flagged events only — preserves the
// envelope for real visitors, gives debuggability for the bot subset.
//
// Same library is used in packages/beacon/src/beacon.ts. The beacon bundles
// isbot into its single-file output via esbuild.

import { isbot } from "isbot";

export { isbot };
