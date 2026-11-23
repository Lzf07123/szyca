package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type catalogFile struct {
	Modules []manifest `json:"modules"`
}

type migrationFile struct {
	Version string `json:"version"`
	SQL     []byte `json:"sql"`
}

type manifest struct {
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
	Requires               []string     `json:"requires"`
	Routes                 []route      `json:"routes"`
	Capabilities           []capability `json:"capabilities"`
	AdminTabs              []adminTab   `json:"admin_tabs"`
	AdminPanels            []adminPanel `json:"admin_panels"`
	Sections               []section    `json:"sections"`
}

type route struct {
	Path       string `json:"path"`
	Feature    string `json:"feature,omitempty"`
	Fullscreen bool   `json:"fullscreen,omitempty"`
}

type capability struct {
	Key   string   `json:"key"`
	Label string   `json:"label"`
	Roles []string `json:"roles"`
}

type adminTab struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	Group      string `json:"group"`
	Permission string `json:"permission"`
	Order      int    `json:"order"`
}

type adminPanel struct {
	Key        string `json:"key"`
	Tab        string `json:"tab"`
	Label      string `json:"label"`
	Permission string `json:"permission"`
	Order      int    `json:"order"`
}

type section struct {
	Key           string         `json:"key"`
	Version       int            `json:"version"`
	Scope         string         `json:"scope"`
	Layout        string         `json:"layout"`
	HomeOrder     int            `json:"home_order,omitempty"`
	Label         string         `json:"label"`
	Description   string         `json:"description"`
	Feature       string         `json:"feature,omitempty"`
	Repeatable    bool           `json:"repeatable"`
	MaxInstances  int            `json:"max_instances"`
	SummaryField  string         `json:"summary_field,omitempty"`
	DefaultConfig map[string]any `json:"default_config"`
	Fields        []sectionField `json:"fields"`
}

type sectionField struct {
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
	ItemFields       []sectionField `json:"item_fields,omitempty"`
}

type outputFile struct {
	path    string
	content []byte
}

func main() {
	write := flag.Bool("write", false, "write generated files")
	check := flag.Bool("check", false, "verify generated files are current")
	flag.Parse()
	if *write == *check {
		fmt.Fprintln(os.Stderr, "modulegen: specify exactly one of --write or --check")
		os.Exit(2)
	}

	root, err := findRoot()
	must(err)
	modules, err := loadModules(root)
	must(err)
	outputs, err := render(root, modules)
	must(err)
	if *write {
		for _, output := range outputs {
			must(os.MkdirAll(filepath.Dir(output.path), 0o755))
			must(os.WriteFile(output.path, output.content, 0o644))
		}
		fmt.Printf("modulegen: wrote %d files for %d modules\n", len(outputs), len(modules))
		return
	}
	for _, output := range outputs {
		current, readErr := os.ReadFile(output.path)
		if readErr != nil {
			must(fmt.Errorf("%s: %w", output.path, readErr))
		}
		if !bytes.Equal(current, output.content) {
			must(fmt.Errorf("%s is stale; run go generate in backend/core/modulecatalog", output.path))
		}
	}
	fmt.Printf("modulegen: %d generated files are current\n", len(outputs))
}

func findRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "modules")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("repository root with modules/ and go.mod not found")
		}
		dir = parent
	}
}

func loadModules(root string) ([]manifest, error) {
	paths, err := filepath.Glob(filepath.Join(root, "modules", "*", "module.json"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, errors.New("no module manifests found")
	}
	sort.Strings(paths)
	modules := make([]manifest, 0, len(paths))
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var module manifest
		if err := json.Unmarshal(raw, &module); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		directoryKey := filepath.Base(filepath.Dir(path))
		if module.Key != directoryKey {
			return nil, fmt.Errorf("%s: key %q does not match directory %q", path, module.Key, directoryKey)
		}
		normalizeSlices(&module)
		if _, err := os.Stat(filepath.Join(root, "modules", module.Key, "frontend", "index.tsx")); err != nil {
			return nil, fmt.Errorf("%s: missing frontend/index.tsx", module.Key)
		}
		modules = append(modules, module)
	}
	sort.Slice(modules, func(i, j int) bool { return modules[i].Key < modules[j].Key })
	if err := validate(modules); err != nil {
		return nil, err
	}
	return modules, nil
}

func normalizeSlices(module *manifest) {
	if module.Requires == nil {
		module.Requires = []string{}
	}
	if module.Routes == nil {
		module.Routes = []route{}
	}
	if module.Capabilities == nil {
		module.Capabilities = []capability{}
	}
	if module.AdminTabs == nil {
		module.AdminTabs = []adminTab{}
	}
	if module.AdminPanels == nil {
		module.AdminPanels = []adminPanel{}
	}
	if module.Sections == nil {
		module.Sections = []section{}
	}
	for index := range module.Capabilities {
		if module.Capabilities[index].Roles == nil {
			module.Capabilities[index].Roles = []string{}
		}
	}
	for index := range module.Sections {
		if module.Sections[index].Fields == nil {
			module.Sections[index].Fields = []sectionField{}
		}
	}
}

func validate(modules []manifest) error {
	keys := map[string]bool{}
	features := map[string]bool{}
	routes := map[string]bool{}
	capabilities := map[string]bool{}
	sections := map[string]bool{}
	adminTabs := map[string]bool{}
	adminPanels := map[string]bool{}
	for _, module := range modules {
		if module.Schema != 1 {
			return fmt.Errorf("%s: unsupported schema %d", module.Key, module.Schema)
		}
		if module.Label == "" {
			return fmt.Errorf("%s: label is required", module.Key)
		}
		if keys[module.Key] {
			return fmt.Errorf("duplicate module key %q", module.Key)
		}
		keys[module.Key] = true
		if module.Feature != "" {
			if module.Path == "" {
				return fmt.Errorf("%s: public feature requires path", module.Key)
			}
			if module.FeatureWriteCapability == "" {
				return fmt.Errorf("%s: public feature requires feature_write_capability", module.Key)
			}
			if features[module.Feature] {
				return fmt.Errorf("duplicate feature %q", module.Feature)
			}
			features[module.Feature] = true
		}
		for _, item := range module.Routes {
			if !strings.HasPrefix(item.Path, "/") {
				return fmt.Errorf("%s: route %q must start with /", module.Key, item.Path)
			}
			if routes[item.Path] {
				return fmt.Errorf("duplicate route %q", item.Path)
			}
			routes[item.Path] = true
			if item.Feature != "" && item.Feature != module.Feature {
				return fmt.Errorf("%s: route %q uses foreign feature %q", module.Key, item.Path, item.Feature)
			}
		}
		for _, item := range module.Capabilities {
			if item.Key == "" || item.Label == "" {
				return fmt.Errorf("%s: capability key and label are required", module.Key)
			}
			if capabilities[item.Key] {
				return fmt.Errorf("duplicate capability %q", item.Key)
			}
			capabilities[item.Key] = true
			for _, role := range item.Roles {
				switch role {
				case "content_editor", "event_operator", "data_viewer":
				default:
					return fmt.Errorf("%s: capability %q has unknown role %q", module.Key, item.Key, role)
				}
			}
		}
		for _, item := range module.AdminTabs {
			if item.Key == "" || item.Label == "" || item.Permission == "" {
				return fmt.Errorf("%s: admin tab key, label and permission are required", module.Key)
			}
			if adminTabs[item.Key] {
				return fmt.Errorf("duplicate admin tab %q", item.Key)
			}
			adminTabs[item.Key] = true
		}
		for _, item := range module.AdminPanels {
			if item.Key == "" || item.Tab == "" || item.Label == "" || item.Permission == "" {
				return fmt.Errorf("%s: admin panel key, tab, label and permission are required", module.Key)
			}
			if adminPanels[item.Key] {
				return fmt.Errorf("duplicate admin panel %q", item.Key)
			}
			adminPanels[item.Key] = true
		}
	}
	for _, module := range modules {
		for _, item := range module.Sections {
			id := fmt.Sprintf("%s@%d", item.Key, item.Version)
			if sections[id] {
				return fmt.Errorf("duplicate section %s", id)
			}
			sections[id] = true
			if item.Layout != "block" && item.Layout != "module-card" {
				return fmt.Errorf("%s: section %s has invalid layout", module.Key, id)
			}
			if item.Feature != "" && !features[item.Feature] {
				return fmt.Errorf("%s: section %s uses unregistered feature %q", module.Key, id, item.Feature)
			}
		}
		for _, item := range module.AdminPanels {
			if !adminTabs[item.Tab] {
				return fmt.Errorf("%s: admin panel %s uses unregistered tab %q", module.Key, item.Key, item.Tab)
			}
		}
	}
	for _, module := range modules {
		for _, required := range module.Requires {
			if !keys[required] {
				return fmt.Errorf("%s: missing dependency %q", module.Key, required)
			}
		}
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	byKey := make(map[string]manifest, len(modules))
	for _, module := range modules {
		byKey[module.Key] = module
	}
	var visit func(string) error
	visit = func(key string) error {
		if visiting[key] {
			return fmt.Errorf("module dependency cycle at %q", key)
		}
		if visited[key] {
			return nil
		}
		visiting[key] = true
		for _, required := range byKey[key].Requires {
			if err := visit(required); err != nil {
				return err
			}
		}
		visiting[key] = false
		visited[key] = true
		return nil
	}
	for _, module := range modules {
		if err := visit(module.Key); err != nil {
			return err
		}
	}
	return nil
}

func render(root string, modules []manifest) ([]outputFile, error) {
	raw, err := json.MarshalIndent(catalogFile{Modules: modules}, "", "  ")
	if err != nil {
		return nil, err
	}
	raw = append(raw, '\n')
	goSource, err := renderGoCatalog()
	if err != nil {
		return nil, err
	}
	tsSource, err := renderTS(modules)
	if err != nil {
		return nil, err
	}
	runtimeSource := renderRuntimeRegistry(modules)
	backendRuntime, err := renderBackendRegistry(modules)
	if err != nil {
		return nil, err
	}
	styleSource, err := renderStyleRegistry(root, modules)
	if err != nil {
		return nil, err
	}
	migrations, err := loadModuleMigrations(root)
	if err != nil {
		return nil, err
	}
	migrationRaw, err := json.MarshalIndent(struct {
		Migrations []migrationFile `json:"migrations"`
	}{Migrations: migrations}, "", "  ")
	if err != nil {
		return nil, err
	}
	migrationRaw = append(migrationRaw, '\n')
	return []outputFile{
		{
			path:    filepath.Join(root, "backend", "core", "modulecatalog", "manifests.generated.json"),
			content: raw,
		},
		{
			path:    filepath.Join(root, "backend", "core", "modulecatalog", "catalog.generated.go"),
			content: goSource,
		},
		{
			path:    filepath.Join(root, "backend", "core", "modulecatalog", "migrations.generated.json"),
			content: migrationRaw,
		},
		{
			path:    filepath.Join(root, "frontend", "src", "generated", "module-catalog.generated.json"),
			content: raw,
		},
		{
			path:    filepath.Join(root, "frontend", "src", "generated", "catalog.generated.ts"),
			content: tsSource,
		},
		{
			path:    filepath.Join(root, "frontend", "src", "modules", "registry.generated.ts"),
			content: runtimeSource,
		},
		{
			path:    filepath.Join(root, "backend", "core", "moduleregistry", "registry.generated.go"),
			content: backendRuntime,
		},
		{
			path:    filepath.Join(root, "frontend", "src", "module-styles.generated.ts"),
			content: styleSource,
		},
	}, nil
}

func loadModuleMigrations(root string) ([]migrationFile, error) {
	paths, err := filepath.Glob(filepath.Join(root, "modules", "*", "backend", "migrations", "*.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	seen := map[string]string{}
	out := make([]migrationFile, 0, len(paths))
	for _, path := range paths {
		version := filepath.Base(path)
		if previous, exists := seen[version]; exists {
			return nil, fmt.Errorf("duplicate migration %s in %s and %s", version, previous, path)
		}
		seen[version] = path
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		out = append(out, migrationFile{Version: version, SQL: raw})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

func renderGoCatalog() ([]byte, error) {
	source := `// Code generated by cmd/modulegen; DO NOT EDIT.

package modulecatalog

import (
	"embed"
	"encoding/json"
	"fmt"
	"sync"

	"szyca/backend/contract"
)

//go:embed manifests.generated.json
var manifestsJSON embed.FS

//go:embed migrations.generated.json
var migrationsJSON embed.FS

var (
	loadOnce  sync.Once
	manifests []contract.Manifest
	loadErr   error
	migrations []contract.Migration
)

func load() error {
	loadOnce.Do(func() {
		raw, err := manifestsJSON.ReadFile("manifests.generated.json")
		if err != nil {
			loadErr = err
			return
		}
		var catalog struct {
			Modules []contract.Manifest ` + "`json:\"modules\"`" + `
		}
		if err := json.Unmarshal(raw, &catalog); err != nil {
			loadErr = err
			return
		}
		manifests = catalog.Modules
		migrationBytes, err := migrationsJSON.ReadFile("migrations.generated.json")
		if err != nil {
			loadErr = err
			return
		}
		var migrationCatalog struct {
			Migrations []contract.Migration ` + "`json:\"migrations\"`" + `
		}
		if err := json.Unmarshal(migrationBytes, &migrationCatalog); err != nil {
			loadErr = err
			return
		}
		migrations = migrationCatalog.Migrations
	})
	return loadErr
}

func All() []contract.Manifest {
	if err := load(); err != nil {
		panic(err)
	}
	out := make([]contract.Manifest, len(manifests))
	copy(out, manifests)
	return out
}

func Get(key string) (contract.Manifest, bool) {
	for _, manifest := range All() {
		if manifest.Key == key {
			return manifest, true
		}
	}
	return contract.Manifest{}, false
}

func FeatureKeys() []string {
	out := []string{}
	for _, manifest := range All() {
		if manifest.Feature != "" {
			out = append(out, manifest.Feature)
		}
	}
	return out
}

func FeatureAllowed(key string) bool {
	for _, feature := range FeatureKeys() {
		if feature == key {
			return true
		}
	}
	return false
}

func Migrations() []contract.Migration {
	if err := load(); err != nil {
		panic(err)
	}
	out := make([]contract.Migration, len(migrations))
	copy(out, migrations)
	return out
}

func FeatureWriteCapability(feature string) (string, error) {
	for _, manifest := range All() {
		if manifest.Feature == feature {
			if manifest.FeatureWriteCapability == "" {
				return "", fmt.Errorf("feature %s has no write capability", feature)
			}
			return manifest.FeatureWriteCapability, nil
		}
	}
	return "", fmt.Errorf("feature %s is not registered", feature)
}

func Sections() []contract.Section {
	out := []contract.Section{}
	for _, manifest := range All() {
		out = append(out, manifest.Sections...)
	}
	return out
}

func CapabilityGrants(role string) []string {
	out := []string{}
	for _, manifest := range All() {
		for _, capability := range manifest.Capabilities {
			for _, grantedRole := range capability.Roles {
				if grantedRole == role {
					out = append(out, capability.Key)
					break
				}
			}
		}
	}
	return out
}
`
	return format.Source([]byte(source))
}

func renderTS(modules []manifest) ([]byte, error) {
	var builder strings.Builder
	builder.WriteString("// Code generated by cmd/modulegen; DO NOT EDIT.\n\n")
	builder.WriteString("import catalog from './module-catalog.generated.json'\n\n")
	builder.WriteString("export interface GeneratedModuleManifest {\n")
	builder.WriteString("  key: string\n  label: string\n  feature?: string\n  path?: string\n")
	builder.WriteString("  nav_label?: string\n  nav_order?: number\n  footer_label?: string\n")
	builder.WriteString("  public_metric?: boolean\n  feature_write_capability?: string\n")
	builder.WriteString("  requires: string[]\n  routes: Array<{ path: string; feature?: string; fullscreen?: boolean }>\n")
	builder.WriteString("  capabilities: Array<{ key: string; label: string; roles: string[] }>\n")
	builder.WriteString("  admin_tabs: Array<{ key: string; label: string; group: string; permission: string; order: number }>\n")
	builder.WriteString("  admin_panels: Array<{ key: string; tab: string; label: string; permission: string; order: number }>\n")
	builder.WriteString("  sections: Array<Record<string, unknown>>\n")
	builder.WriteString("}\n\n")
	builder.WriteString("export const MODULE_CATALOG = catalog.modules as unknown as GeneratedModuleManifest[]\n")
	builder.WriteString("export const MODULE_CATALOG_KEYS = MODULE_CATALOG.map((module) => module.key)\n")
	builder.WriteString("export const FEATURE_KEYS = MODULE_CATALOG.flatMap((module) => module.feature ? [module.feature] : [])\n\n")
	builder.WriteString("export function featureWriteCapability(feature: string): string | undefined {\n")
	builder.WriteString("  return MODULE_CATALOG.find((module) => module.feature === feature)?.feature_write_capability\n")
	builder.WriteString("}\n")
	_ = modules
	return formatTS(builder.String()), nil
}

func renderRuntimeRegistry(modules []manifest) []byte {
	var builder strings.Builder
	builder.WriteString("// Code generated by cmd/modulegen; DO NOT EDIT.\n\n")
	builder.WriteString("import type { AppModuleRuntime } from '@core/modules/contract'\n")
	for _, module := range modules {
		fmt.Fprintf(&builder, "import { moduleRuntime as %sRuntime } from '@modules/%s/frontend'\n", goIdent(module.Key), module.Key)
	}
	builder.WriteString("\nexport const MODULE_RUNTIMES: readonly AppModuleRuntime[] = [\n")
	for _, module := range modules {
		fmt.Fprintf(&builder, "  %sRuntime,\n", goIdent(module.Key))
	}
	builder.WriteString("]\n")
	return []byte(builder.String())
}

func renderStyleRegistry(root string, modules []manifest) ([]byte, error) {
	var builder strings.Builder
	builder.WriteString("// Code generated by cmd/modulegen; DO NOT EDIT.\n\n")
	for _, module := range modules {
		path := filepath.Join(root, "modules", module.Key, "frontend", "styles.css")
		if _, err := os.Stat(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}
		fmt.Fprintf(&builder, "import '@modules/%s/frontend/styles.css'\n", module.Key)
	}
	return []byte(builder.String()), nil
}

func renderBackendRegistry(modules []manifest) ([]byte, error) {
	var builder strings.Builder
	builder.WriteString("// Code generated by cmd/modulegen; DO NOT EDIT.\n\n")
	builder.WriteString("package moduleregistry\n\n")
	builder.WriteString("import (\n\t\"context\"\n\t\"fmt\"\n\n")
	builder.WriteString("\t\"szyca/backend/contract\"\n\t\"szyca/backend/core/modulecatalog\"\n")
	for _, module := range modules {
		fmt.Fprintf(&builder, "\t%s %q\n", moduleKeyIdent(module.Key), "szyca/modules/"+module.Key+"/backend")
	}
	builder.WriteString(")\n\n")
	builder.WriteString("type Runtime struct {\n\tModules map[string]contract.Module\n\tServices map[string]any\n}\n\n")
	builder.WriteString("func (r *Runtime) Service(key string) (any, bool) {\n\tvalue, ok := r.Services[key]\n\treturn value, ok\n}\n\n")
	builder.WriteString("func Build(ctx context.Context, core map[string]any) (*Runtime, error) {\n")
	builder.WriteString("\tfactories := map[string]contract.Factory{\n")
	for _, module := range modules {
		fmt.Fprintf(&builder, "\t\t%q: %s.NewModule,\n", module.Key, moduleKeyIdent(module.Key))
	}
	builder.WriteString("\t}\n")
	builder.WriteString("\truntime := &Runtime{Modules: map[string]contract.Module{}, Services: map[string]any{}}\n")
	builder.WriteString("\tfor len(runtime.Modules) < len(factories) {\n\t\tprogress := false\n")
	builder.WriteString("\t\tfor _, manifest := range modulecatalog.All() {\n")
	builder.WriteString("\t\t\tif _, exists := runtime.Modules[manifest.Key]; exists { continue }\n")
	builder.WriteString("\t\t\tready := true\n\t\t\tfor _, requirement := range manifest.Requires {\n")
	builder.WriteString("\t\t\t\tif _, ok := runtime.Services[requirement]; !ok { ready = false; break }\n\t\t\t}\n")
	builder.WriteString("\t\t\tif !ready { continue }\n")
	builder.WriteString("\t\t\tfactory, ok := factories[manifest.Key]\n\t\t\tif !ok { return nil, fmt.Errorf(\"module %s has no generated factory\", manifest.Key) }\n")
	builder.WriteString("\t\t\tmodule, err := factory(contract.Dependencies{Context: ctx, Core: core, Module: runtime.Services})\n")
	builder.WriteString("\t\t\tif err != nil { return nil, fmt.Errorf(\"build module %s: %w\", manifest.Key, err) }\n")
	builder.WriteString("\t\t\truntime.Modules[manifest.Key] = module\n\t\t\truntime.Services[manifest.Key] = module.Service()\n\t\t\tprogress = true\n\t\t}\n")
	builder.WriteString("\t\tif !progress { return nil, fmt.Errorf(\"module dependency graph cannot be resolved\") }\n\t}\n")
	builder.WriteString("\treturn runtime, nil\n}\n\n")
	builder.WriteString("func (r *Runtime) Ready(ctx context.Context) error {\n")
	builder.WriteString("\tfor _, manifest := range modulecatalog.All() {\n\t\tif module, ok := r.Modules[manifest.Key]; ok {\n\t\t\tif err := module.Ready(ctx); err != nil { return fmt.Errorf(\"ready module %s: %w\", manifest.Key, err) }\n\t\t}\n\t}\n\treturn nil\n}\n\n")
	builder.WriteString("func (r *Runtime) Start(ctx context.Context) error {\n")
	builder.WriteString("\tfor _, manifest := range modulecatalog.All() {\n\t\tif module, ok := r.Modules[manifest.Key]; ok {\n\t\t\tif err := module.Start(ctx); err != nil { return fmt.Errorf(\"start module %s: %w\", manifest.Key, err) }\n\t\t}\n\t}\n\treturn nil\n}\n")
	builder.WriteString("\nfunc (r *Runtime) Stop(ctx context.Context) error {\n")
	builder.WriteString("\tmanifests := modulecatalog.All()\n\tfor index := len(manifests) - 1; index >= 0; index-- {\n\t\tif module, ok := r.Modules[manifests[index].Key]; ok {\n\t\t\tif err := module.Stop(ctx); err != nil { return fmt.Errorf(\"stop module %s: %w\", manifests[index].Key, err) }\n\t\t}\n\t}\n\treturn nil\n}\n")
	return format.Source([]byte(builder.String()))
}

func moduleKeyIdent(key string) string {
	return strings.ReplaceAll(goIdent(key), "-", "")
}

func goIdent(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '_' })
	for index, part := range parts {
		parts[index] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, "")
}

func formatTS(source string) []byte {
	return []byte(source)
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "modulegen:", err)
		os.Exit(1)
	}
}
