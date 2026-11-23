package contract

import (
	"context"
	"encoding/json"
)

type NavContribution struct {
	Label string `json:"label"`
	Order int    `json:"order"`
}

type Capability struct {
	Key   string   `json:"key"`
	Label string   `json:"label"`
	Roles []string `json:"roles"`
}

type Route struct {
	Path       string `json:"path"`
	Feature    string `json:"feature,omitempty"`
	Fullscreen bool   `json:"fullscreen,omitempty"`
}

type AdminTab struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	Group      string `json:"group"`
	Permission string `json:"permission"`
	Order      int    `json:"order"`
}

type AdminPanel struct {
	Key        string `json:"key"`
	Tab        string `json:"tab"`
	Label      string `json:"label"`
	Permission string `json:"permission"`
	Order      int    `json:"order"`
}

type SectionField struct {
	Key              string         `json:"key"`
	Label            string         `json:"label"`
	Type             string         `json:"type"`
	Description      string         `json:"description,omitempty"`
	Placeholder      string         `json:"placeholder,omitempty"`
	Group            string         `json:"group,omitempty"`
	GroupLabel       string         `json:"group_label,omitempty"`
	GroupDescription string         `json:"group_description,omitempty"`
	MaxLength        int            `json:"max_length,omitempty"`
	MaxItems         int            `json:"max_items,omitempty"`
	ItemFields       []SectionField `json:"item_fields,omitempty"`
}

type Section struct {
	Key           string          `json:"key"`
	Version       int             `json:"version"`
	Scope         string          `json:"scope"`
	Layout        string          `json:"layout"`
	HomeOrder     int             `json:"home_order,omitempty"`
	Label         string          `json:"label"`
	Description   string          `json:"description"`
	Feature       string          `json:"feature,omitempty"`
	Repeatable    bool            `json:"repeatable"`
	MaxInstances  int             `json:"max_instances"`
	SummaryField  string          `json:"summary_field,omitempty"`
	DefaultConfig json.RawMessage `json:"default_config"`
	Fields        []SectionField  `json:"fields"`
}

type Manifest struct {
	Schema                 int          `json:"schema"`
	Key                    string       `json:"key"`
	Label                  string       `json:"label"`
	Feature                string       `json:"feature,omitempty"`
	Path                   string       `json:"path,omitempty"`
	NavLabel               string       `json:"nav_label,omitempty"`
	NavOrder               int          `json:"nav_order,omitempty"`
	FooterLabel            string       `json:"footer_label,omitempty"`
	PublicMetric           bool         `json:"public_metric,omitempty"`
	FeatureWriteCapability string       `json:"feature_write_capability,omitempty"`
	Requires               []string     `json:"requires,omitempty"`
	Routes                 []Route      `json:"routes,omitempty"`
	Capabilities           []Capability `json:"capabilities,omitempty"`
	AdminTabs              []AdminTab   `json:"admin_tabs,omitempty"`
	AdminPanels            []AdminPanel `json:"admin_panels,omitempty"`
	Sections               []Section    `json:"sections,omitempty"`
}

type Migration struct {
	Version string
	SQL     []byte
}

type Dependencies struct {
	Context context.Context
	Core    map[string]any
	Module  map[string]any
}

func (d Dependencies) CoreService(key string) (any, bool) {
	value, ok := d.Core[key]
	return value, ok
}

func (d Dependencies) ModuleService(key string) (any, bool) {
	value, ok := d.Module[key]
	return value, ok
}

type Module interface {
	Manifest() Manifest
	Service() any
	Migrations() []Migration
	Ready(context.Context) error
	Start(context.Context) error
	Stop(context.Context) error
}

type Factory func(Dependencies) (Module, error)

type Definition struct {
	Manifest Manifest
	Factory  Factory
}
