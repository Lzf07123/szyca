package join

import (
	"context"
	"errors"

	"szyca/backend/contract"
	"szyca/backend/core/modulecatalog"
	"szyca/backend/core/store"
)

type module struct {
	service *Service
}

var _ contract.HTTPModule = (*module)(nil)

func NewModule(deps contract.Dependencies) (contract.Module, error) {
	st, ok := deps.Core["store"].(*store.Store)
	if !ok {
		return nil, errors.New("join module requires store")
	}
	return &module{service: New(st.Pool())}, nil
}

func (m *module) Manifest() contract.Manifest {
	manifest, _ := modulecatalog.Get("join")
	return manifest
}

func (m *module) Service() any { return m.service }

func (m *module) Migrations() []contract.Migration { return nil }

func (m *module) Ready(context.Context) error { return nil }

func (m *module) Start(context.Context) error { return nil }

func (m *module) Stop(context.Context) error { return nil }
