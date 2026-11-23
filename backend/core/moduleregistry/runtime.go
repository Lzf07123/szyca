package moduleregistry

import (
	"szyca/backend/contract"
	"szyca/backend/core/modulecatalog"
)

func (r *Runtime) List() []contract.Module {
	out := make([]contract.Module, 0, len(r.Modules))
	for _, manifest := range modulecatalog.All() {
		if module, ok := r.Modules[manifest.Key]; ok {
			out = append(out, module)
		}
	}
	return out
}
