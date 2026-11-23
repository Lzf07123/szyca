package site

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	ConfigFieldText     = "text"
	ConfigFieldTextarea = "textarea"
	ConfigFieldPath     = "path"
	ConfigFieldItems    = "items"
)

var pluginKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// SectionPluginManifest is the stable contract between the Go plugin registry
// and the React editor/renderer registry. The backend owns the key, version,
// defaults, permission binding and configuration schema.
type SectionPluginManifest struct {
	Key           string               `json:"key"`
	Version       int                  `json:"version"`
	Scope         string               `json:"scope"`
	Label         string               `json:"label"`
	Description   string               `json:"description"`
	Feature       string               `json:"feature,omitempty"`
	Repeatable    bool                 `json:"repeatable"`
	MaxInstances  int                  `json:"max_instances"`
	SummaryField  string               `json:"summary_field,omitempty"`
	DefaultConfig json.RawMessage      `json:"default_config"`
	Fields        []SectionConfigField `json:"fields"`
}

// SectionConfigField is a deliberately small declarative editor schema.
// Plugin authors can add fields without changing the generic admin editor.
type SectionConfigField struct {
	Key              string               `json:"key"`
	Label            string               `json:"label"`
	Type             string               `json:"type"`
	Description      string               `json:"description,omitempty"`
	Placeholder      string               `json:"placeholder,omitempty"`
	Group            string               `json:"group,omitempty"`
	GroupLabel       string               `json:"group_label,omitempty"`
	GroupDescription string               `json:"group_description,omitempty"`
	MaxLength        int                  `json:"max_length,omitempty"`
	MaxItems         int                  `json:"max_items,omitempty"`
	ItemFields       []SectionConfigField `json:"item_fields,omitempty"`
}

type sectionPluginRegistry struct {
	manifests []SectionPluginManifest
	byKey     map[string]SectionPluginManifest
}

func newSectionPluginRegistry(manifests ...SectionPluginManifest) (*sectionPluginRegistry, error) {
	registry := &sectionPluginRegistry{
		manifests: append([]SectionPluginManifest(nil), manifests...),
		byKey:     make(map[string]SectionPluginManifest, len(manifests)),
	}
	for index := range registry.manifests {
		manifest := &registry.manifests[index]
		if err := normalizeManifest(manifest); err != nil {
			return nil, fmt.Errorf("section plugin %q: %w", manifest.Key, err)
		}
		if _, exists := registry.byKey[manifest.Key]; exists {
			return nil, fmt.Errorf("duplicate section plugin key %q", manifest.Key)
		}
		registry.byKey[manifest.Key] = *manifest
	}
	return registry, nil
}

func (r *sectionPluginRegistry) List() []SectionPluginManifest {
	out := make([]SectionPluginManifest, len(r.manifests))
	copy(out, r.manifests)
	return out
}

func (r *sectionPluginRegistry) Get(key string) (SectionPluginManifest, bool) {
	manifest, ok := r.byKey[key]
	return manifest, ok
}

func (r *sectionPluginRegistry) NormalizeConfig(
	pluginKey string,
	raw json.RawMessage,
) (json.RawMessage, error) {
	manifest, ok := r.Get(pluginKey)
	if !ok {
		return nil, fmt.Errorf("不支持的 Section 插件：%s", pluginKey)
	}
	return normalizePluginConfig(manifest, raw)
}

func normalizeManifest(manifest *SectionPluginManifest) error {
	if !pluginKeyPattern.MatchString(manifest.Key) {
		return errors.New("key 必须是小写字母开头的 URL-safe 标识")
	}
	if manifest.Version <= 0 {
		return errors.New("version 必须大于 0")
	}
	if manifest.Scope != "home" {
		return fmt.Errorf("不支持的 scope：%s", manifest.Scope)
	}
	if strings.TrimSpace(manifest.Label) == "" {
		return errors.New("label 不能为空")
	}
	if manifest.Feature != "" && !allowedFeatures[manifest.Feature] {
		return fmt.Errorf("未注册的 feature：%s", manifest.Feature)
	}
	if manifest.MaxInstances < 0 {
		return errors.New("max_instances 不能小于 0")
	}
	if len(manifest.DefaultConfig) == 0 {
		manifest.DefaultConfig = json.RawMessage(`{}`)
	}
	if _, err := decodeConfigObject(manifest.DefaultConfig); err != nil {
		return fmt.Errorf("default_config 无效：%w", err)
	}
	if len(manifest.Fields) == 0 {
		return errors.New("fields 不能为空")
	}
	seen := make(map[string]bool, len(manifest.Fields))
	for index := range manifest.Fields {
		field := &manifest.Fields[index]
		if _, err := normalizeField(field, false); err != nil {
			return fmt.Errorf("field %q: %w", field.Key, err)
		}
		if seen[field.Key] {
			return fmt.Errorf("重复字段 %q", field.Key)
		}
		seen[field.Key] = true
	}
	if manifest.SummaryField != "" {
		field, ok := findConfigField(manifest.Fields, manifest.SummaryField)
		if !ok || field.Type == ConfigFieldItems {
			return fmt.Errorf("summary_field %q 必须指向文本字段", manifest.SummaryField)
		}
	}
	if _, err := normalizePluginConfig(*manifest, manifest.DefaultConfig); err != nil {
		return fmt.Errorf("default_config 不符合 fields：%w", err)
	}
	normalized, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	var clean SectionPluginManifest
	if err := json.Unmarshal(normalized, &clean); err != nil {
		return err
	}
	*manifest = clean
	return nil
}

func normalizeField(field *SectionConfigField, nested bool) (map[string]SectionConfigField, error) {
	field.Key = strings.TrimSpace(field.Key)
	if !pluginKeyPattern.MatchString(field.Key) {
		return nil, errors.New("key 必须是小写字母开头的 URL-safe 标识")
	}
	if strings.TrimSpace(field.Label) == "" {
		return nil, errors.New("label 不能为空")
	}
	if field.Group == "" {
		field.Group = "content"
	}
	if field.GroupLabel == "" {
		field.GroupLabel = "内容配置"
	}
	switch field.Type {
	case ConfigFieldText, ConfigFieldTextarea, ConfigFieldPath:
		if field.MaxLength <= 0 {
			field.MaxLength = 1000
		}
		if field.MaxLength > 4000 {
			return nil, errors.New("max_length 过大")
		}
		field.ItemFields = nil
		return nil, nil
	case ConfigFieldItems:
		if nested {
			return nil, errors.New("item_fields 不支持嵌套 items")
		}
		if field.MaxItems <= 0 {
			field.MaxItems = 8
		}
		if field.MaxItems > 32 {
			return nil, errors.New("max_items 最大为 32")
		}
		if len(field.ItemFields) == 0 {
			return nil, errors.New("items 字段必须声明 item_fields")
		}
		items := make(map[string]SectionConfigField, len(field.ItemFields))
		for index := range field.ItemFields {
			item := &field.ItemFields[index]
			if _, err := normalizeField(item, true); err != nil {
				return nil, fmt.Errorf("item field %q: %w", item.Key, err)
			}
			if items[item.Key].Key != "" {
				return nil, fmt.Errorf("重复 item field %q", item.Key)
			}
			items[item.Key] = *item
		}
		return items, nil
	default:
		return nil, fmt.Errorf("不支持的字段类型 %q", field.Type)
	}
}

func findConfigField(fields []SectionConfigField, key string) (SectionConfigField, bool) {
	for _, field := range fields {
		if field.Key == key {
			return field, true
		}
	}
	return SectionConfigField{}, false
}

func normalizePluginConfig(
	manifest SectionPluginManifest,
	raw json.RawMessage,
) (json.RawMessage, error) {
	if len(raw) > 32<<10 {
		return nil, errors.New("配置过大")
	}
	defaults, err := decodeConfigObject(manifest.DefaultConfig)
	if err != nil {
		return nil, fmt.Errorf("默认配置无效：%w", err)
	}
	provided, err := decodeConfigObject(raw)
	if err != nil {
		return nil, err
	}
	if containsHTML(provided) {
		return nil, errors.New("配置只接受纯文本，不允许 HTML")
	}
	merged := make(map[string]any, len(defaults)+len(provided))
	for key, value := range defaults {
		merged[key] = value
	}
	for key, value := range provided {
		merged[key] = value
	}

	fields := make(map[string]SectionConfigField, len(manifest.Fields))
	for _, field := range manifest.Fields {
		fields[field.Key] = field
	}
	for key := range merged {
		if _, ok := fields[key]; !ok {
			return nil, fmt.Errorf("未知字段 %s", key)
		}
	}
	for key, field := range fields {
		value, exists := merged[key]
		if !exists {
			continue
		}
		if err := validateFieldValue(field, value); err != nil {
			return nil, fmt.Errorf("%s：%w", key, err)
		}
	}
	normalized, err := json.Marshal(merged)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func decodeConfigObject(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.New("必须是 JSON 对象")
	}
	if value == nil {
		return nil, errors.New("必须是 JSON 对象")
	}
	return value, nil
}

func validateFieldValue(field SectionConfigField, value any) error {
	if field.Type == ConfigFieldItems {
		items, ok := value.([]any)
		if !ok {
			return errors.New("必须是数组")
		}
		if len(items) > field.MaxItems {
			return fmt.Errorf("最多允许 %d 项", field.MaxItems)
		}
		itemFields := make(map[string]SectionConfigField, len(field.ItemFields))
		for _, itemField := range field.ItemFields {
			itemFields[itemField.Key] = itemField
		}
		for index, item := range items {
			object, ok := item.(map[string]any)
			if !ok {
				return fmt.Errorf("第 %d 项必须是对象", index+1)
			}
			for key, itemValue := range object {
				itemField, exists := itemFields[key]
				if !exists {
					return fmt.Errorf("第 %d 项包含未知字段 %s", index+1, key)
				}
				if err := validateFieldValue(itemField, itemValue); err != nil {
					return fmt.Errorf("第 %d 项 %s：%w", index+1, key, err)
				}
			}
		}
		return nil
	}

	text, ok := value.(string)
	if !ok {
		return errors.New("必须是文本")
	}
	if len([]rune(text)) > field.MaxLength {
		return fmt.Errorf("最多允许 %d 个字符", field.MaxLength)
	}
	if containsHTML(text) {
		return errors.New("不允许 HTML")
	}
	if field.Type == ConfigFieldPath && text != "" &&
		(!strings.HasPrefix(text, "/") || strings.Contains(text, ":")) {
		return errors.New("必须是站内路径")
	}
	return nil
}

func builtinSectionPlugins() []SectionPluginManifest {
	return []SectionPluginManifest{
		{
			Key: "hero", Version: 1, Scope: "home", Label: "首页首屏",
			Description: "页面打开后的第一屏，包含主标题、副标题和主次入口。",
			Repeatable:  true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"汕头职业技术学院 · 计算机协会","title":"新的首页首屏","subtitle":"补充首屏副标题，并配置主要入口。","primary_label":"开始答题","primary_to":"/quiz","secondary_label":"加入我们","secondary_to":"/join"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "首屏文案", 120),
				textField("title", "标题", "content", "首屏文案", 120),
				textareaField("subtitle", "副标题", "content", "首屏文案", 1000),
				textField("primary_label", "主按钮文案", "actions", "首屏入口", 120),
				pathField("primary_to", "主按钮路径", "actions", "首屏入口", "/quiz"),
				textField("secondary_label", "次按钮文案", "actions", "首屏入口", 120),
				pathField("secondary_to", "次按钮路径", "actions", "首屏入口", "/join"),
			},
		},
		{
			Key: "about", Version: 1, Scope: "home", Label: "协会介绍",
			Description: "展示协会定位和介绍正文。",
			Repeatable:  true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"关于协会","title":"关于我们","body":"介绍协会的定位、日常活动与参与方式。"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "介绍内容", 120),
				textField("title", "标题", "content", "介绍内容", 120),
				textareaField("body", "正文", "content", "介绍内容", 1000),
			},
		},
		{
			Key: "activities", Version: 1, Scope: "home", Label: "活动类型",
			Description: "展示技术分享、项目协作与竞赛实践等活动标签。",
			Repeatable:  true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"持续发生","title":"活动类型","body":"协会日常活动。","items":[{"title":"技术分享","body":"从 Web 开发到容器云，以能上手为目标组织分享。"}]}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "活动内容", 120),
				textField("title", "标题", "content", "活动内容", 120),
				textareaField("body", "正文", "content", "活动内容", 1000),
				itemsField("items", "活动条目", "活动条目", 8,
					textField("title", "名称", "item", "活动条目", 120),
					textareaField("body", "说明", "item", "活动条目", 500),
				),
			},
		},
		{
			Key: "quiz", Version: 1, Scope: "home", Label: "答题入口",
			Description: "一个独立的答题模块卡片，可重复添加为多个入口。",
			Feature:     FeatureQuiz, Repeatable: true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"现场挑战","title":"答题中心","body":"完成一轮答题，查看成绩与排名。","action_label":"进入答题","action_to":"/quiz"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "模块文案", 120),
				textField("title", "标题", "content", "模块文案", 120),
				textareaField("body", "正文", "content", "模块文案", 1000),
				textField("action_label", "按钮文案", "actions", "模块入口", 120),
				pathField("action_to", "站内路径", "actions", "模块入口", "/quiz"),
			},
		},
		{
			Key: "lottery", Version: 1, Scope: "home", Label: "抽奖信息",
			Description: "独立活动区块，可重复添加为多个活动信号。",
			Feature:     FeatureLottery, Repeatable: true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"现场福利","title":"抽奖信息","body":"完成答题后参与现场抽奖。","action_label":"查看活动","action_to":"/lottery"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "活动文案", 120),
				textField("title", "标题", "content", "活动文案", 120),
				textareaField("body", "正文", "content", "活动文案", 1000),
				textField("action_label", "按钮文案", "actions", "活动入口", 120),
				pathField("action_to", "站内路径", "actions", "活动入口", "/lottery"),
			},
		},
		{
			Key: FeatureJoin, Version: 1, Scope: "home", Label: "加入我们",
			Description: "一个独立的加入入口卡片，可重复添加。",
			Feature:     FeatureJoin, Repeatable: true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"保持联系","title":"加入我们","body":"扫码加入招新群，获取后续活动信息。","action_label":"查看加入方式","action_to":"/join"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "模块文案", 120),
				textField("title", "标题", "content", "模块文案", 120),
				textareaField("body", "正文", "content", "模块文案", 1000),
				textField("action_label", "按钮文案", "actions", "模块入口", 120),
				pathField("action_to", "站内路径", "actions", "模块入口", "/join"),
			},
		},
		{
			Key: "gallery", Version: 2, Scope: "home", Label: "活动影像",
			Description: "展示活动图片与其他现场影像，可重复添加多个图集。",
			Repeatable:  true, SummaryField: "title",
			DefaultConfig: json.RawMessage(`{"eyebrow":"协会现场","title":"活动影像","body":"技术分享、比赛与协作时刻。"}`),
			Fields: []SectionConfigField{
				textField("eyebrow", "眉题", "content", "影像文案", 120),
				textField("title", "标题", "content", "影像文案", 120),
				textareaField("body", "正文", "content", "影像文案", 1000),
			},
		},
	}
}

func textField(key, label, group, groupLabel string, maxLength int) SectionConfigField {
	return SectionConfigField{
		Key: key, Label: label, Type: ConfigFieldText,
		Group: group, GroupLabel: groupLabel, MaxLength: maxLength,
	}
}

func textareaField(key, label, group, groupLabel string, maxLength int) SectionConfigField {
	return SectionConfigField{
		Key: key, Label: label, Type: ConfigFieldTextarea,
		Group: group, GroupLabel: groupLabel, MaxLength: maxLength,
	}
}

func pathField(key, label, group, groupLabel, placeholder string) SectionConfigField {
	return SectionConfigField{
		Key: key, Label: label, Type: ConfigFieldPath,
		Group: group, GroupLabel: groupLabel, Placeholder: placeholder, MaxLength: 1000,
	}
}

func itemsField(
	key, label, groupLabel string,
	maxItems int,
	itemFields ...SectionConfigField,
) SectionConfigField {
	return SectionConfigField{
		Key: key, Label: label, Type: ConfigFieldItems,
		Group: "items", GroupLabel: groupLabel, MaxItems: maxItems, ItemFields: itemFields,
	}
}
