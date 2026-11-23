package contract

import "context"

type IdentityValidator interface {
	ValidateToken(context.Context, string) (User, error)
}

type Readiness interface {
	Ready(context.Context) error
}

type ConfigContributor interface {
	Config(context.Context) (map[string]any, error)
}

type OverviewContributor interface {
	Overview(context.Context) (map[string]any, error)
}
