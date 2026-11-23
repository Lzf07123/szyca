package site

import "context"

// SectionAvailabilityProvider lets a module hide its public Section instances
// when a module-level sub-mode is disabled.
type SectionAvailabilityProvider interface {
	SectionAvailability(
		ctx context.Context,
		kinds []string,
	) (map[string]bool, error)
}
