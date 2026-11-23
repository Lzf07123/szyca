package ws

import (
	"context"
	"errors"

	"szyca/backend/contract"
	"szyca/backend/core/modulecatalog"
	"szyca/backend/core/publish"
	"szyca/backend/core/store"
)

type module struct {
	service *Service
}

var _ contract.HTTPModule = (*module)(nil)
var _ contract.ConfigContributor = (*module)(nil)

func NewModule(deps contract.Dependencies) (contract.Module, error) {
	pub, ok := deps.Core["publish"].(*publish.Pub)
	if !ok {
		return nil, errors.New("realtime module requires publish")
	}
	top, ok := deps.Module["quiz"].(TopProvider)
	if !ok {
		return nil, errors.New("realtime module requires quiz top provider")
	}
	st, ok := deps.Core["store"].(*store.Store)
	if !ok {
		return nil, errors.New("realtime module requires store")
	}
	hub := NewHub(top, pub.Subscribe(deps.Context))
	return &module{service: New(st.Pool(), hub, pub)}, nil
}

func (m *module) Manifest() contract.Manifest {
	manifest, _ := modulecatalog.Get("realtime")
	return manifest
}

func (m *module) Service() any { return m.service }

func (m *module) Migrations() []contract.Migration { return nil }

func (m *module) Ready(context.Context) error { return nil }

func (m *module) Config(ctx context.Context) (map[string]any, error) {
	announcement, err := m.service.LatestAnnouncement(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"announcement": announcement}, nil
}

func (m *module) Start(ctx context.Context) error {
	go m.service.Hub().Run(ctx)
	return nil
}

func (m *module) Stop(context.Context) error { return nil }
