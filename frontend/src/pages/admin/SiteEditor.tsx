import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type {
  SectionConfig,
  SectionItem,
  SectionPluginField,
  SectionPluginManifest,
  SiteFeature,
} from '../../api/site'
import {
  sectionConfigItems,
  sectionConfigText,
  type SectionEditorProps,
} from '../../site-sections/contract'
import {
  SECTION_FRONTEND_PLUGINS,
  supportsSectionPlugin,
} from '../../site-sections/registry'
import { moduleForFeature } from '../../modules/registry'

type SectionStatus = 'draft' | 'published' | 'archived'

interface ManagedSection {
  id: number
  kind: string
  plugin_version: number
  enabled: boolean
  sort: number
  starts_at?: string
  ends_at?: string
  config: SectionConfig
  status: SectionStatus
}

interface Props {
  canWrite: boolean
  canManageLottery: boolean
  onMessage: (message: string, error?: boolean) => void
  onSaved: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

interface FieldGroup {
  key: string
  label: string
  description?: string
  fields: SectionPluginField[]
}

const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

function cloneConfig(config: SectionConfig): SectionConfig {
  return JSON.parse(JSON.stringify(config ?? {})) as SectionConfig
}

function normalizeSections(sections: ManagedSection[]): ManagedSection[] {
  return [...sections]
    .map((section) => ({ ...section, plugin_version: section.plugin_version || 1 }))
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
}

function localDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function featureSignature(features: SiteFeature[]) {
  return JSON.stringify(features
    .map((feature) => ({
      key: feature.key,
      enabled: feature.enabled,
    }))
    .sort((a, b) => a.key.localeCompare(b.key)))
}

function sectionSignature(sections: ManagedSection[], deletedIDs: number[]) {
  return JSON.stringify({
    sections: sections
      .map((section) => ({
        id: section.id,
        kind: section.kind,
        plugin_version: section.plugin_version,
        enabled: section.enabled,
        sort: section.sort,
        starts_at: section.starts_at,
        ends_at: section.ends_at,
        config: section.config,
        status: section.status,
      }))
      .sort((a, b) => a.id - b.id),
    deleted_ids: [...deletedIDs].sort((a, b) => a - b),
  })
}

function fieldGroups(plugin: SectionPluginManifest): FieldGroup[] {
  const groups = new Map<string, FieldGroup>()
  for (const field of plugin.fields ?? []) {
    const key = field.group || 'content'
    const group = groups.get(key) ?? {
      key,
      label: field.group_label || '内容字段',
      description: field.group_description,
      fields: [],
    }
    group.fields.push(field)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function sectionTitle(section: ManagedSection, plugin: SectionPluginManifest) {
  const title = sectionConfigText(section.config, plugin.summary_field || 'title')
  if (title.trim()) return title.trim()
  const tags = sectionConfigItems(section.config)
    .map((item) => typeof item.title === 'string' ? item.title.trim() : '')
    .filter(Boolean)
  return tags.length > 0 ? tags.slice(0, 3).join(' / ') : plugin.label
}

function sectionAvailability(
  section: ManagedSection,
  plugin: SectionPluginManifest | undefined,
  frontendAvailable: boolean,
  features: SiteFeature[],
) {
  if (!plugin || !frontendAvailable) {
    return {
      label: '插件不可用',
      detail: '前端未注册该插件或版本不兼容；数据会保留，可删除但不会公开渲染。',
      tone: 'hidden',
    }
  }
  if (!section.enabled) {
    return { label: '未显示', detail: '区块已停用', tone: 'hidden' }
  }
  if (section.status === 'draft') {
    return { label: '草稿', detail: '尚未发布到公开端', tone: 'hidden' }
  }
  if (section.status === 'archived') {
    return { label: '已归档', detail: '归档内容不会公开显示', tone: 'hidden' }
  }
  if (plugin.feature && !features.find((feature) => feature.key === plugin.feature)?.enabled) {
    return {
      label: '模块关闭',
      detail: `${plugin.label}的模块总开关当前关闭`,
      tone: 'hidden',
    }
  }

  const now = Date.now()
  const startsAt = section.starts_at ? new Date(section.starts_at).getTime() : null
  const endsAt = section.ends_at ? new Date(section.ends_at).getTime() : null
  if (startsAt && startsAt > now) {
    return {
      label: '定时上线',
      detail: `将于 ${new Date(startsAt).toLocaleString('zh-CN')} 公开`,
      tone: 'scheduled',
    }
  }
  if (endsAt && endsAt <= now) {
    return { label: '已过期', detail: '结束时间已到，公开端不再显示', tone: 'hidden' }
  }
  if (endsAt) {
    return {
      label: '当前公开',
      detail: `将在 ${new Date(endsAt).toLocaleString('zh-CN')} 下线`,
      tone: 'live',
    }
  }
  return { label: '当前公开', detail: '公开端正在显示此区块', tone: 'live' }
}

function inputValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function SectionFieldEditor({
  field,
  value,
  canWrite,
  onChange,
}: {
  field: SectionPluginField
  value: unknown
  canWrite: boolean
  onChange: (value: string) => void
}) {
  const text = inputValue(value)
  const maxLength = (field.max_length ?? 0) > 0 ? field.max_length : undefined
  const label = (
    <>
      {field.label}
      {field.description && <small className="field-hint">{field.description}</small>}
    </>
  )
  if (field.type === 'textarea') {
    return (
      <label className="field">
        {label}
        <textarea
          rows={3}
          value={text}
          disabled={!canWrite}
          maxLength={maxLength}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }
  return (
    <label className="field">
      {label}
      <input
        value={text}
        disabled={!canWrite}
        maxLength={maxLength}
        placeholder={field.placeholder}
        pattern={field.type === 'path' ? '/.*' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function ItemFieldEditor({
  field,
  value,
  canWrite,
  onChange,
}: {
  field: SectionPluginField
  value: unknown
  canWrite: boolean
  onChange: (value: string) => void
}) {
  return (
    <SectionFieldEditor
      field={{ ...field, group: undefined, group_label: undefined, group_description: undefined }}
      value={value}
      canWrite={canWrite}
      onChange={onChange}
    />
  )
}

function SectionFieldsEditor({
  section,
  plugin,
  canWrite,
  updateConfig,
  updateItems,
}: SectionEditorProps) {
  return (
    <>
      {fieldGroups(plugin).map((group) => (
        <div className="section-form-block" key={group.key}>
          <div className="section-form-heading">
            <h3>{group.label}</h3>
            {group.description && <p>{group.description}</p>}
          </div>
          {group.fields.map((field) => {
            if (field.type !== 'items') {
              return (
                <SectionFieldEditor
                  key={field.key}
                  field={field}
                  value={section.config[field.key]}
                  canWrite={canWrite}
                  onChange={(value) => updateConfig(field.key, value)}
                />
              )
            }

            const items = sectionConfigItems(section.config, field.key)
            const itemFields = field.item_fields?.length
              ? field.item_fields
              : [{ key: 'title', label: '内容', type: 'text' as const, max_length: 120 }]
            const maxItems = (field.max_items ?? 0) > 0 ? field.max_items ?? 8 : 8
            return (
              <div className="plugin-items-editor" key={field.key}>
                <p className="plugin-items-hint">
                  {field.label}：{field.description || `最多 ${maxItems} 项，可排序新增和删除。`}
                </p>
                {items.map((item, itemIndex) => (
                  <div className="plugin-item-card" key={`${field.key}-${itemIndex}`}>
                    <div className="plugin-item-fields">
                      {itemFields.map((itemField) => (
                        <ItemFieldEditor
                          key={itemField.key}
                          field={itemField}
                          value={item[itemField.key]}
                          canWrite={canWrite}
                          onChange={(value) => {
                            const next = items.map((candidate, index) => (
                              index === itemIndex ? { ...candidate, [itemField.key]: value } : candidate
                            ))
                            updateItems(field.key, next)
                          }}
                        />
                      ))}
                    </div>
                    {canWrite && (
                      <button
                        className="mini-btn danger"
                        type="button"
                        onClick={() => updateItems(
                          field.key,
                          items.filter((_, index) => index !== itemIndex),
                        )}
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
                {items.length === 0 && <p className="muted">还没有内容项。</p>}
                {canWrite && items.length < maxItems && (
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() => updateItems(field.key, [...items, {}])}
                  >
                    新增{field.label}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

export default function SiteEditor({
  canWrite,
  canManageLottery,
  onMessage,
  onSaved,
  onDirtyChange,
}: Props) {
  const [sections, setSections] = useState<ManagedSection[]>([])
  const [features, setFeatures] = useState<SiteFeature[]>([])
  const [sectionPlugins, setSectionPlugins] = useState<SectionPluginManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [savingSections, setSavingSections] = useState(false)
  const [savedFeatures, setSavedFeatures] = useState<SiteFeature[] | null>(null)
  const [savedSections, setSavedSections] = useState<ManagedSection[] | null>(null)
  const [deletedSections, setDeletedSections] = useState<ManagedSection[]>([])
  const [expandedSectionID, setExpandedSectionID] = useState<number | null>(null)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const nextDraftID = useRef(-1)
  const featuresDirty = useMemo(
    () => savedFeatures !== null && featureSignature(features) !== featureSignature(savedFeatures),
    [features, savedFeatures],
  )
  const sectionsDirty = useMemo(
    () => savedSections !== null
      && sectionSignature(sections, deletedSections.map((section) => section.id))
        !== sectionSignature(savedSections, []),
    [deletedSections, savedSections, sections],
  )
  const dirty = featuresDirty || sectionsDirty
  const pluginManifests = useMemo(
    () => new Map(sectionPlugins.map((plugin) => [`${plugin.key}@${plugin.version}`, plugin])),
    [sectionPlugins],
  )
  const frontendPlugins = useMemo(
    () => new Map(SECTION_FRONTEND_PLUGINS.map((plugin) => [`${plugin.key}@${plugin.version}`, plugin])),
    [],
  )
  const manifestFor = (section: ManagedSection) => (
    pluginManifests.get(`${section.kind}@${section.plugin_version || 1}`)
  )

  const load = async () => {
    setLoading(true)
    try {
      const [sectionData, featureData, pluginData] = await Promise.all([
        api<{ sections: ManagedSection[] }>('/api/admin/site/sections'),
        api<{ features: SiteFeature[] }>('/api/admin/platform/features'),
        api<{ plugins: SectionPluginManifest[] }>('/api/admin/site/section-plugins'),
      ])
      const nextSections = normalizeSections(sectionData.sections)
      setSections(nextSections)
      setSavedSections(nextSections)
      setDeletedSections([])
      setExpandedSectionID(null)
      setShowSectionPicker(false)
      setFeatures(featureData.features)
      setSavedFeatures(featureData.features)
      setSectionPlugins(pluginData.plugins)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const updateSection = <K extends keyof ManagedSection>(id: number, key: K, value: ManagedSection[K]) => {
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, [key]: value } : section
    )))
  }

  const updateConfig = (id: number, key: string, value: unknown) => {
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, config: { ...section.config, [key]: value } } : section
    )))
  }

  const updateItems = (id: number, key: string, items: SectionItem[]) => {
    updateConfig(id, key, items)
  }

  const moveSection = (id: number, direction: -1 | 1) => {
    const ordered = [...sections].sort((a, b) => a.sort - b.sort || a.id - b.id)
    const index = ordered.findIndex((section) => section.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    const reordered = [...ordered]
    reordered[index] = ordered[target]
    reordered[target] = ordered[index]
    setSections(reordered.map((section, position) => ({ ...section, sort: (position + 1) * 10 })))
  }

  const canAddPlugin = (plugin: SectionPluginManifest) => {
    if (!supportsSectionPlugin(plugin.key, plugin.version)) return false
    const count = sections.filter((section) => (
      section.kind === plugin.key && section.plugin_version === plugin.version
    )).length
    if (!plugin.repeatable && count > 0) return false
    return (plugin.max_instances ?? 0) <= 0 || count < plugin.max_instances
  }

  const addSection = (plugin: SectionPluginManifest) => {
    if (!canWrite || !canAddPlugin(plugin)) return
    const ordered = [...sections].sort((a, b) => a.sort - b.sort || a.id - b.id)
    const sort = ordered.reduce((highest, section) => Math.max(highest, section.sort), 0) + 10
    const id = nextDraftID.current
    nextDraftID.current -= 1
    const nextSection: ManagedSection = {
      id,
      kind: plugin.key,
      plugin_version: plugin.version,
      enabled: true,
      sort,
      config: cloneConfig(plugin.default_config),
      status: 'draft',
    }
    setSections((current) => [...current, nextSection])
    setExpandedSectionID(id)
    setShowSectionPicker(false)
    window.requestAnimationFrame(() => {
      document.getElementById(`section-editor-${id}`)?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  }

  const removeSection = (section: ManagedSection) => {
    if (!canWrite) return
    const plugin = manifestFor(section)
    const label = plugin?.label || section.kind
    const prompt = section.id > 0
      ? section.status === 'published'
        ? `确认删除「${label}」实例 #${section.id}？保存编排后，公开首页会立即移除该实例。`
        : `确认删除「${label}」实例 #${section.id}？该实例的配置会一并删除。`
      : `确认移除尚未保存的「${label}」实例？`
    if (!window.confirm(prompt)) return
    setSections((current) => current.filter((candidate) => candidate.id !== section.id))
    if (section.id > 0) {
      setDeletedSections((current) => [
        ...current.filter((candidate) => candidate.id !== section.id),
        section,
      ])
    }
    if (expandedSectionID === section.id) setExpandedSectionID(null)
  }

  const undoDeletedSections = () => {
    if (deletedSections.length === 0) return
    setSections((current) => (
      [...current, ...deletedSections].sort((a, b) => a.sort - b.sort || a.id - b.id)
    ))
    setDeletedSections([])
  }

  const saveSections = async () => {
    if (!canWrite || savingSections || !sectionsDirty) return
    setSavingSections(true)
    try {
      const supportedSections = [...sections]
        .filter((section) => manifestFor(section) && supportsSectionPlugin(
          section.kind,
          section.plugin_version,
        ))
        .sort((a, b) => a.sort - b.sort || a.id - b.id)
      const response = await api<{ sections: ManagedSection[] }>('/api/admin/site/sections', {
        method: 'PUT',
        body: JSON.stringify({
          sections: supportedSections.map((section) => ({
            id: section.id > 0 ? section.id : 0,
            kind: section.kind,
            plugin_version: section.plugin_version,
            enabled: section.enabled,
            sort: section.sort,
            starts_at: section.starts_at ? new Date(section.starts_at).toISOString() : null,
            ends_at: section.ends_at ? new Date(section.ends_at).toISOString() : null,
            config: section.config,
            status: section.status,
          })),
          deleted_ids: deletedSections.map((section) => section.id),
        }),
      })
      const nextSections = normalizeSections(response.sections)
      await onSaved()
      setSections(nextSections)
      setSavedSections(nextSections)
      setDeletedSections([])
      setExpandedSectionID(null)
      onMessage('首页编排已保存，公开端现在生效')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setSavingSections(false)
    }
  }

  const saveFeatures = async () => {
    if (!canWrite || savingFeatures || !featuresDirty) return
    const editable = features.filter((feature) => (
      feature.key !== 'lottery' || canManageLottery
    ))
    setSavingFeatures(true)
    try {
      await api('/api/admin/platform/features', {
        method: 'PUT',
        body: JSON.stringify({ features: editable }),
      })
      await onSaved()
      setSavedFeatures(features)
      onMessage('模块开关已保存')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setSavingFeatures(false)
    }
  }

  if (loading) return <div className="admin-loading" role="status">正在读取站点配置…</div>

  const orderedSections = [...sections].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const availablePlugins = sectionPlugins
    .filter((plugin) => supportsSectionPlugin(plugin.key, plugin.version))
  return (
    <div className="admin-stack">
      {!canWrite && (
        <div className="read-only-note" role="status">
          当前角色可查看站点配置，但没有编辑与发布权限。
        </div>
      )}

      <section
        className="card admin-section-card site-module-switches"
        aria-busy={savingFeatures}
      >
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">MODULE SWITCHES</p>
            <h2>公开模块开关</h2>
            <p className="muted">总开关控制公开导航、入口与接口，保存后立即生效。</p>
          </div>
          <div className="panel-head-actions">
            {featuresDirty && <span className="status-chip unsaved">有未保存开关</span>}
            {canWrite && (
              <button
                className="btn btn-primary site-module-save"
                type="button"
                disabled={savingFeatures || !featuresDirty}
                onClick={() => void saveFeatures()}
              >
                {savingFeatures ? '保存中…' : '保存开关'}
              </button>
            )}
          </div>
        </div>
        <div className="feature-switch-grid">
          {features.map((feature) => {
            const editable = canWrite && (feature.key !== 'lottery' || canManageLottery)
            return (
              <label className="feature-switch" key={feature.key}>
                <span>
                  <strong>{moduleForFeature(feature.key)?.label || feature.key}</strong>
                  <small>{feature.enabled ? '公开端可见' : '入口与接口关闭'}</small>
                </span>
                <input
                  type="checkbox"
                  checked={feature.enabled}
                  disabled={!editable}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setFeatures((current) => current.map((item) => (
                      item.key === feature.key ? { ...item, enabled } : item
                    )))
                  }}
                />
              </label>
            )
          })}
        </div>
      </section>

      <section className="card admin-section-card section-composer" aria-busy={savingSections}>
        <div className="panel-head section-composer-head">
          <div>
            <p className="section-eyebrow">HOMEPAGE COMPOSITION</p>
            <h2>首页内容编排</h2>
            <p className="muted">Section 以插件实例编排，同一类型可重复添加；每个实例独立排序、发布和删除。</p>
          </div>
          <div className="panel-head-actions">
            {sectionsDirty && <span className="status-chip unsaved">有未保存编排</span>}
            {canWrite && (
              <button
                className="btn btn-secondary"
                type="button"
                aria-expanded={showSectionPicker}
                aria-controls="section-picker"
                onClick={() => setShowSectionPicker((visible) => !visible)}
              >
                {showSectionPicker ? '收起新增' : '新增区块'}
              </button>
            )}
            {canWrite && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={savingSections || !sectionsDirty}
                onClick={() => void saveSections()}
              >
                {savingSections ? '保存中…' : '保存编排'}
              </button>
            )}
          </div>
        </div>

        {showSectionPicker && canWrite && (
          <div className="section-picker" id="section-picker" role="region" aria-label="新增首页区块">
            <div className="section-picker-head">
              <div>
                <h3>选择 Section 插件</h3>
                <p>新实例以草稿加入页面末尾；插件字段、默认值和校验规则由后端 Manifest 提供。</p>
              </div>
              <button className="mini-btn" type="button" onClick={() => setShowSectionPicker(false)}>
                关闭
              </button>
            </div>
            <div className="section-picker-grid">
              {availablePlugins.map((plugin) => {
                const count = sections.filter((section) => (
                  section.kind === plugin.key && section.plugin_version === plugin.version
                )).length
                const allowed = canAddPlugin(plugin)
                return (
                  <button
                    className="section-picker-option"
                    type="button"
                    key={`${plugin.key}@${plugin.version}`}
                    disabled={!allowed}
                    onClick={() => addSection(plugin)}
                  >
                    <span>
                      <strong>{plugin.label}</strong>
                      <small>{plugin.description}</small>
                    </span>
                    <b>
                      {count > 0 ? `已添加 ${count} 个 · ` : ''}
                      {allowed ? '+ 添加' : '不可添加'}
                    </b>
                  </button>
                )
              })}
              {availablePlugins.length === 0 && (
                <p className="section-picker-empty">
                  当前没有前后端版本匹配的 Section 插件，请检查插件注册表。
                </p>
              )}
            </div>
          </div>
        )}

        {deletedSections.length > 0 && (
          <div className="section-deletion-notice" role="status">
            <span>
              待删除：{deletedSections.map((section) => (
                manifestFor(section)?.label || section.kind
              )).join('、')}，保存后生效。
            </span>
            <button className="mini-btn" type="button" onClick={undoDeletedSections}>
              撤销删除
            </button>
          </div>
        )}

        <div className="section-editor-list">
          {orderedSections.map((section, index) => {
            const plugin = manifestFor(section)
            const frontendPlugin = plugin
              ? frontendPlugins.get(`${plugin.key}@${plugin.version}`)
              : undefined
            const compatible = Boolean(plugin && frontendPlugin)
            const availability = sectionAvailability(section, plugin, compatible, features)
            const expanded = expandedSectionID === section.id
            const title = plugin ? sectionTitle(section, plugin) : section.kind
            const sameKindCount = orderedSections.filter((candidate) => (
              candidate.kind === section.kind
              && candidate.plugin_version === section.plugin_version
            )).length
            const instanceIndex = orderedSections
              .filter((candidate) => (
                candidate.kind === section.kind
                && candidate.plugin_version === section.plugin_version
              ))
              .findIndex((candidate) => candidate.id === section.id) + 1
            const CustomEditor = frontendPlugin?.Editor
            const editorProps: SectionEditorProps | null = compatible && plugin ? {
              section,
              plugin,
              canWrite,
              updateConfig: (key, value) => updateConfig(section.id, key, value),
              updateItems: (key, items) => updateItems(section.id, key, items),
              onChanged: onSaved,
            } : null

            return (
              <article className={`section-editor${expanded ? ' is-open' : ''}`} key={section.id}>
                <div className="section-editor-summary">
                  <button
                    className="section-summary-toggle"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`section-editor-${section.id}`}
                    onClick={() => setExpandedSectionID(expanded ? null : section.id)}
                  >
                    <span className="section-order-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="section-summary-copy">
                      <span className="section-summary-kicker">
                        {plugin?.label || section.kind}
                        {sameKindCount > 1 ? ` · 实例 ${instanceIndex}` : ''}
                        {' · '}v{section.plugin_version}
                      </span>
                      <strong>{title}</strong>
                      <small>{plugin?.description || '插件未注册或版本不兼容。'}</small>
                    </span>
                    <span className="section-summary-action">{expanded ? '收起' : '编辑'}</span>
                  </button>
                  <div className="section-summary-controls">
                    <span className={`section-visibility is-${availability.tone}`}>
                      {availability.label}
                    </span>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        disabled={!canWrite || !compatible}
                        onChange={(event) => updateSection(section.id, 'enabled', event.target.checked)}
                      />
                      {section.enabled ? '已启用' : '已停用'}
                    </label>
                  </div>
                </div>

                {expanded && (
                  <div className="section-editor-body" id={`section-editor-${section.id}`}>
                    <div className="section-order-toolbar">
                      <div>
                        <span>页面位置</span>
                        <strong>第 {index + 1} 位</strong>
                      </div>
                      <div className="section-order-actions">
                        <button
                          className="mini-btn"
                          type="button"
                          disabled={!canWrite || !compatible || index === 0}
                          onClick={() => moveSection(section.id, -1)}
                        >
                          上移
                        </button>
                        <button
                          className="mini-btn"
                          type="button"
                          disabled={!canWrite || !compatible || index === orderedSections.length - 1}
                          onClick={() => moveSection(section.id, 1)}
                        >
                          下移
                        </button>
                        {canWrite && (
                          <button
                            className="mini-btn danger section-delete-action"
                            type="button"
                            onClick={() => removeSection(section)}
                          >
                            删除区块
                          </button>
                        )}
                      </div>
                    </div>

                    {!compatible && (
                      <div className="read-only-note" role="status">
                        {availability.detail}
                      </div>
                    )}
                    {compatible && editorProps && (
                      <>
                        <SectionFieldsEditor {...editorProps} />
                        {CustomEditor && <CustomEditor {...editorProps} />}
                      </>
                    )}

                    <details className="section-publish-settings">
                      <summary>
                        <span>
                          <b>发布与定时</b>
                          <small>{availability.detail}</small>
                        </span>
                        <span>{SECTION_STATUS_LABEL[section.status]} · {availability.label}</span>
                      </summary>
                      <div className="section-publish-body">
                        <label className="field">
                          发布状态
                          <select
                            value={section.status}
                            disabled={!canWrite || !compatible}
                            onChange={(event) => updateSection(
                              section.id,
                              'status',
                              event.target.value as SectionStatus,
                            )}
                          >
                            <option value="draft">草稿（不公开）</option>
                            <option value="published">已发布</option>
                            <option value="archived">归档（保留内容）</option>
                          </select>
                        </label>
                        <div className="form-grid">
                          <label className="field">
                            定时开始（可选）
                            <input
                              type="datetime-local"
                              value={localDateTime(section.starts_at)}
                              disabled={!canWrite || !compatible}
                              onChange={(event) => updateSection(
                                section.id,
                                'starts_at',
                                event.target.value || undefined,
                              )}
                            />
                          </label>
                          <label className="field">
                            定时结束（可选）
                            <input
                              type="datetime-local"
                              value={localDateTime(section.ends_at)}
                              disabled={!canWrite || !compatible}
                              onChange={(event) => updateSection(
                                section.id,
                                'ends_at',
                                event.target.value || undefined,
                              )}
                            />
                          </label>
                        </div>
                        <p className="section-publish-hint">
                          留空表示立即生效或长期有效。结束时间必须晚于开始时间。
                        </p>
                      </div>
                    </details>
                  </div>
                )}
              </article>
            )
          })}
          {orderedSections.length === 0 && (
            <p className="muted">首页目前没有区块。可在上方选择插件新增，保存后会展示空站状态。</p>
          )}
        </div>
      </section>
    </div>
  )
}
