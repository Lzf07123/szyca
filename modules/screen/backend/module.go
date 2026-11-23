package screen

import (
	"context"
	"errors"

	"szyca/backend/contract"
	"szyca/backend/core/modulecatalog"
)

type module struct {
	service *Service
}

var _ contract.HTTPModule = (*module)(nil)

func NewModule(deps contract.Dependencies) (contract.Module, error) {
	ranking, ok := deps.Module["quiz"].(RankingReader)
	if !ok {
		return nil, errors.New("screen module requires quiz ranking reader")
	}
	return &module{service: New(ranking)}, nil
}

func (m *module) Manifest() contract.Manifest {
	manifest, _ := modulecatalog.Get("screen")
	return manifest
}

func (m *module) Service() any { return m.service }

func (m *module) Migrations() []contract.Migration { return nil }

func (m *module) Ready(context.Context) error { return nil }

func (m *module) Start(context.Context) error { return nil }

func (m *module) Stop(context.Context) error { return nil }
