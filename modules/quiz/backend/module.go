package quiz

import (
	"context"
	"errors"

	"szyca/backend/contract"
	"szyca/backend/core/config"
	"szyca/backend/core/modulecatalog"
	"szyca/backend/core/publish"
	"szyca/backend/core/rank"
	"szyca/backend/core/store"
)

type module struct {
	service *Service
	runtime *Runtime
	cfg     config.Config
}

var _ contract.HTTPModule = (*module)(nil)
var _ contract.ConfigContributor = (*module)(nil)
var _ contract.OverviewContributor = (*module)(nil)

func NewModule(deps contract.Dependencies) (contract.Module, error) {
	st, ok := deps.Core["store"].(*store.Store)
	if !ok {
		return nil, errors.New("quiz module requires store")
	}
	rk, ok := deps.Core["rank"].(*rank.Rank)
	if !ok {
		return nil, errors.New("quiz module requires rank")
	}
	pub, ok := deps.Core["publish"].(*publish.Pub)
	if !ok {
		return nil, errors.New("quiz module requires publish")
	}
	cfg, ok := deps.Core["config"].(config.Config)
	if !ok {
		return nil, errors.New("quiz module requires config")
	}
	service := New(
		st, rk, pub, cfg.Title, cfg.QuestionSeconds, cfg.AnswerGraceSeconds,
	)
	if err := service.EnsureSeed(deps.Context); err != nil {
		return nil, err
	}
	return &module{service: service, runtime: &Runtime{Service: service}, cfg: cfg}, nil
}

func (m *module) Manifest() contract.Manifest {
	manifest, _ := modulecatalog.Get("quiz")
	return manifest
}

func (m *module) Service() any { return m.runtime }

func (m *module) Migrations() []contract.Migration { return nil }

func (m *module) Ready(ctx context.Context) error { return m.service.Ready(ctx) }

func (m *module) Config(ctx context.Context) (map[string]any, error) {
	state, err := m.service.State(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"title":            m.service.Title(),
		"quiz_state":       state,
		"question_seconds": m.cfg.QuestionSeconds,
	}, nil
}

func (m *module) Overview(ctx context.Context) (map[string]any, error) {
	overview, err := m.service.Overview(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"users": overview.Users, "attempts": overview.Attempts,
		"participants": overview.Participants, "questions": overview.Questions,
		"db": overview.DB, "redis": overview.Redis,
	}, nil
}

func (m *module) Start(ctx context.Context) error {
	m.service.StartLeaderboardRefresh(ctx)
	return nil
}

func (m *module) Stop(context.Context) error { return nil }
