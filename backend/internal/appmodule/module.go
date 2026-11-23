package appmodule

// Manifest describes one optional application module. The composition layer
// uses it for feature validation and public navigation; HTTP registration is
// provided separately by the module route registry.
type Manifest struct {
	Key         string
	Label       string
	Feature     string
	Path        string
	NavLabel    string
	NavOrder    int
	FooterLabel string
}

const (
	KeyJoin     = "join"
	KeyQuiz     = "quiz"
	KeyLottery  = "lottery"
	KeyScreen   = "screen"
	KeyGallery  = "gallery"
	KeyRealtime = "realtime"
)

var builtins = []Manifest{
	{
		Key: KeyJoin, Label: "加入我们", Feature: "join", Path: "/join",
		NavLabel: "加入我们", NavOrder: 20, FooterLabel: "加入我们",
	},
	{
		Key: KeyQuiz, Label: "答题", Feature: "quiz", Path: "/quiz",
		NavLabel: "答题", NavOrder: 30, FooterLabel: "答题",
	},
	{
		Key: KeyLottery, Label: "抽奖", Feature: "lottery", Path: "/lottery",
		NavLabel: "抽奖", NavOrder: 40,
	},
	{
		Key: KeyScreen, Label: "排行榜", Feature: "screen", Path: "/screen",
		NavLabel: "排行榜", NavOrder: 50, FooterLabel: "排行榜",
	},
	{
		Key: KeyRealtime, Label: "实时推送",
	},
	{
		Key: KeyGallery, Label: "活动影像",
	},
}

func All() []Manifest {
	out := make([]Manifest, len(builtins))
	copy(out, builtins)
	return out
}

func Get(key string) (Manifest, bool) {
	for _, manifest := range builtins {
		if manifest.Key == key {
			return manifest, true
		}
	}
	return Manifest{}, false
}

func FeatureKeys() []string {
	out := make([]string, 0, len(builtins))
	for _, manifest := range builtins {
		if manifest.Feature != "" {
			out = append(out, manifest.Feature)
		}
	}
	return out
}

func FeatureAllowed(key string) bool {
	for _, manifest := range builtins {
		if manifest.Feature == key {
			return true
		}
	}
	return false
}
