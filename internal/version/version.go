// Package version exposes the build-time version string for sig.
// The release workflow overrides the default via an ldflags `-X`
// injection; local dev builds show "dev".
package version

var version = "dev"

// Version returns the linker-injected version (e.g. "0.5.0") or
// "dev" when built without the release workflow's ldflags.
func Version() string {
	return version
}
