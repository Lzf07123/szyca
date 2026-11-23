import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { SectionConfig, SectionItem, SiteFeature } from '../../api/site'

interface ManagedSection {
  id: number
  kind: 'hero' | 'about' | 'activities' | 'quiz' | 'lottery' | 'join' | 'gallery'
  enabled: boolean
  sort: number
  starts_at?: string
  ends_at?: string
  config: SectionConfig
  status: 'draft' | 'published' | 'archived'
}

interface Props {
  canWrite: boolean
  canManageLottery: boolean
  onMessage: (message: string, error?: boolean) => void
  onSaved: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

const SECTION_META: Record<ManagedSection['kind'], {
  label: string
  description: string
  feature?: SiteFeature['key']
}> = {
  hero: {
    label: '首页首屏',
    description: '页面打开后的第一屏，包含主标题、副标题和主次入口。',
  },
  about: {
    label: '协会介绍',
    description: '展示协会定位、介绍正文和活动标签。',
  },
  activities: {
    label: '活动标签',
    description: '标签会并入协会介绍，不会单独占据一个页面区块。',
  },
  quiz: {
    label: '答题入口',
    description: '与排行榜、加入我们共同组成核心模块区域。',
    feature: 'quiz',
  },
  lottery: {
    label: '抽奖信息',
    description: '独立活动区块；模块总开关关闭时不会显示。',
    feature: 'lottery',
  },
  join: {
    label: '加入我们',
    description: '与答题、排行榜共同组成核心模块区域。',
    feature: 'join',
  },
  gallery: {
    label: '活动影像',
    description: '首页底部的活动图片与其他现场影像。',
  },
}

const SECTION_STATUS_LABEL: Record<ManagedSection['status'], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

function localDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function sectionTitle(section: ManagedSection) {
  if (section.kind === 'activities') {
    const tags = (section.config.items ?? [])
      .map((item) => item.title?.trim())
      .filter((title): title is string => Boolean(title))
    return tags.length > 0 ? tags.slice(0, 3).join(' / ') : '尚未配置活动标签'
  }
  return section.config.title?.trim() || SECTION_META[section.kind].label
}

function featureSignature(features: SiteFeature[]) {
  return JSON.stringify(features
    .map((feature) => ({
      key: feature.key,
      enabled: feature.enabled,
    }))
    .sort((a, b) => a.key.localeCompare(b.key)))
}

function sectionSignature(sections: ManagedSection[]) {
  return JSON.stringify(sections
    .map((section) => ({
      id: section.id,
      kind: section.kind,
      enabled: section.enabled,
      sort: section.sort,
      starts_at: section.starts_at,
      ends_at: section.ends_at,
      config: section.config,
      status: section.status,
    }))
    .sort((a, b) => a.id - b.id))
}

function sectionAvailability(
  section: ManagedSection,
  features: SiteFeature[],
  sections: ManagedSection[],
) {
  if (!section.enabled) {
    return { label: '未显示', detail: '区块已停用', tone: 'hidden' }
  }
  if (section.status === 'draft') {
    return { label: '草稿', detail: '尚未发布到公开端', tone: 'hidden' }
  }
  if (section.status === 'archived') {
    return { label: '已归档', detail: '归档内容不会公开显示', tone: 'hidden' }
  }

  const featureKey = SECTION_META[section.kind].feature
  if (featureKey && !features.find((feature) => feature.key === featureKey)?.enabled) {
    return { label: '模块关闭', detail: `${SECTION_META[section.kind].label}的总开关当前关闭`, tone: 'hidden' }
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
  if (section.kind === 'activities') {
    const about = sections.find((candidate) => candidate.kind === 'about')
    const aboutStart = about?.starts_at ? new Date(about.starts_at).getTime() : null
    const aboutEnd = about?.ends_at ? new Date(about.ends_at).getTime() : null
    const aboutVisible = about?.enabled &&
      about.status === 'published' &&
      (!aboutStart || aboutStart <= now) &&
      (!aboutEnd || aboutEnd > now)
    if (!aboutVisible) {
      return { label: '未显示', detail: '需要先公开「协会介绍」区块', tone: 'hidden' }
    }
    return { label: '已并入介绍', detail: '活动标签随协会介绍一起显示', tone: 'live' }
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

export default function SiteEditor({
  canWrite,
  canManageLottery,
  onMessage,
  onSaved,
  onDirtyChange,
}: Props) {
  const [sections, setSections] = useState<ManagedSection[]>([])
  const [features, setFeatures] = useState<SiteFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [savingSections, setSavingSections] = useState(false)
  const [savedFeatures, setSavedFeatures] = useState<SiteFeature[] | null>(null)
  const [savedSections, setSavedSections] = useState<ManagedSection[] | null>(null)
  const [expandedSectionID, setExpandedSectionID] = useState<number | null>(null)
  const featuresDirty = useMemo(
    () => savedFeatures !== null && featureSignature(features) !== featureSignature(savedFeatures),
    [features, savedFeatures],
  )
  const sectionsDirty = useMemo(
    () => savedSections !== null && sectionSignature(sections) !== sectionSignature(savedSections),
    [savedSections, sections],
  )
  const dirty = featuresDirty || sectionsDirty

  const load = async () => {
    setLoading(true)
    try {
      const [sectionData, featureData] = await Promise.all([
        api<{ sections: ManagedSection[] }>('/api/admin/site/sections'),
        api<{ features: SiteFeature[] }>('/api/admin/platform/features'),
      ])
      const nextSections = [...sectionData.sections].sort((a, b) => a.sort - b.sort || a.id - b.id)
      setSections(nextSections)
      setSavedSections(nextSections)
      setFeatures(featureData.features)
      setSavedFeatures(featureData.features)
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

  const updateConfig = (id: number, key: keyof SectionConfig, value: string) => {
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, config: { ...section.config, [key]: value } } : section
    )))
  }

  const updateActivityItems = (id: number, items: SectionItem[]) => {
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, config: { ...section.config, items } } : section
    )))
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

  const saveSections = async () => {
    if (!canWrite || savingSections || !sectionsDirty) return
    setSavingSections(true)
    try {
      await api('/api/admin/site/sections', {
        method: 'PUT',
        body: JSON.stringify({
          sections: [...sections].sort((a, b) => a.sort - b.sort || a.id - b.id).map((section) => ({
            id: section.id,
            kind: section.kind,
            enabled: section.enabled,
            sort: section.sort,
            starts_at: section.starts_at ? new Date(section.starts_at).toISOString() : null,
            ends_at: section.ends_at ? new Date(section.ends_at).toISOString() : null,
            config: section.config,
            status: section.status,
          })),
        }),
      })
      await onSaved()
      setSavedSections(sections)
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
  const featureLabels: Record<SiteFeature['key'], string> = {
    quiz: '答题',
    lottery: '抽奖',
    join: '加入我们',
    screen: '排行榜',
  }

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
                  <strong>{featureLabels[feature.key]}</strong>
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
            <p className="muted">按页面浏览顺序管理区块。只有同时满足“已启用、已发布、在有效时间内、模块开关开启”的内容才会公开显示。</p>
          </div>
          <div className="panel-head-actions">
            {sectionsDirty && <span className="status-chip unsaved">有未保存编排</span>}
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

        <div className="section-editor-list">
          {orderedSections.map((section, index) => {
            const meta = SECTION_META[section.kind]
            const availability = sectionAvailability(section, features, orderedSections)
            const expanded = expandedSectionID === section.id
            const isActivities = section.kind === 'activities'
            const showEyebrow = section.kind === 'gallery'
            const title = sectionTitle(section)
            const activityItems = section.config.items ?? []
            const canMove = canWrite && !isActivities

            return (
              <article
                className={`section-editor${expanded ? ' is-open' : ''}`}
                key={section.id}
              >
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
                      <span className="section-summary-kicker">{meta.label}</span>
                      <strong>{title}</strong>
                      <small>{meta.description}</small>
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
                        disabled={!canWrite}
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
                          disabled={!canMove || index === 0}
                          onClick={() => moveSection(section.id, -1)}
                        >
                          上移
                        </button>
                        <button
                          className="mini-btn"
                          type="button"
                          disabled={!canMove || index === orderedSections.length - 1}
                          onClick={() => moveSection(section.id, 1)}
                        >
                          下移
                        </button>
                      </div>
                      {isActivities && <small>活动标签随「协会介绍」显示，不单独占据页面位置。</small>}
                    </div>

                    {isActivities ? (
                      <div className="section-form-block">
                        <div className="section-form-heading">
                          <h3>活动标签</h3>
                          <p>公开端会在协会介绍中显示前 3 个标签；这里编辑标签名称，最多保存 8 个。</p>
                        </div>
                        <div className="activity-tag-editor-list">
                          {activityItems.map((item, itemIndex) => (
                            <div className="activity-tag-editor-row" key={`${index}-${item.image_url ?? 'tag'}-${itemIndex}`}>
                              <label className="field">
                                标签 {itemIndex + 1}
                                <input
                                  value={item.title ?? ''}
                                  disabled={!canWrite}
                                  maxLength={120}
                                  onChange={(event) => {
                                    const next = activityItems.map((candidate, candidateIndex) => (
                                      candidateIndex === itemIndex
                                        ? { ...candidate, title: event.target.value }
                                        : candidate
                                    ))
                                    updateActivityItems(section.id, next)
                                  }}
                                />
                              </label>
                              {canWrite && (
                                <button
                                  className="mini-btn danger"
                                  type="button"
                                  onClick={() => updateActivityItems(
                                    section.id,
                                    activityItems.filter((_, candidateIndex) => candidateIndex !== itemIndex),
                                  )}
                                >
                                  删除
                                </button>
                              )}
                            </div>
                          ))}
                          {activityItems.length === 0 && <p className="muted">还没有活动标签。</p>}
                        </div>
                        {canWrite && activityItems.length < 8 && (
                          <button
                            className="mini-btn"
                            type="button"
                            onClick={() => updateActivityItems(section.id, [...activityItems, { title: '' }])}
                          >
                            新增标签
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="section-form-block">
                        <div className="section-form-heading">
                          <h3>文案内容</h3>
                          <p>{meta.description}</p>
                        </div>
                        {showEyebrow ? (
                          <div className="form-grid">
                            <label className="field">
                              眉题
                              <input
                                value={section.config.eyebrow ?? ''}
                                disabled={!canWrite}
                                maxLength={80}
                                onChange={(event) => updateConfig(section.id, 'eyebrow', event.target.value)}
                              />
                            </label>
                            <label className="field">
                              标题
                              <input
                                value={section.config.title ?? ''}
                                disabled={!canWrite}
                                maxLength={120}
                                onChange={(event) => updateConfig(section.id, 'title', event.target.value)}
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="field">
                            标题
                            <input
                              value={section.config.title ?? ''}
                              disabled={!canWrite}
                              maxLength={120}
                              onChange={(event) => updateConfig(section.id, 'title', event.target.value)}
                            />
                          </label>
                        )}
                        <label className="field">
                          {section.kind === 'hero' ? '副标题' : '正文'}
                          <textarea
                            rows={3}
                            value={section.kind === 'hero'
                              ? section.config.subtitle ?? ''
                              : section.config.body ?? ''}
                            disabled={!canWrite}
                            maxLength={1000}
                            onChange={(event) => updateConfig(
                              section.id,
                              section.kind === 'hero' ? 'subtitle' : 'body',
                              event.target.value,
                            )}
                          />
                        </label>
                      </div>
                    )}

                    {section.kind === 'hero' && (
                      <div className="section-form-block">
                        <div className="section-form-heading">
                          <h3>首屏入口</h3>
                          <p>留空时公开端会按当前开放模块自动选择入口。</p>
                        </div>
                        <div className="form-grid">
                          <label className="field">
                            主按钮文案
                            <input
                              value={section.config.primary_label ?? ''}
                              disabled={!canWrite}
                              onChange={(event) => updateConfig(section.id, 'primary_label', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            主按钮路径
                            <input
                              value={section.config.primary_to ?? ''}
                              disabled={!canWrite}
                              pattern="/.*"
                              placeholder="/quiz"
                              onChange={(event) => updateConfig(section.id, 'primary_to', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            次按钮文案
                            <input
                              value={section.config.secondary_label ?? ''}
                              disabled={!canWrite}
                              onChange={(event) => updateConfig(section.id, 'secondary_label', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            次按钮路径
                            <input
                              value={section.config.secondary_to ?? ''}
                              disabled={!canWrite}
                              pattern="/.*"
                              placeholder="/join"
                              onChange={(event) => updateConfig(section.id, 'secondary_to', event.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {section.kind === 'lottery' && (
                      <div className="section-form-block">
                        <div className="section-form-heading">
                          <h3>活动入口</h3>
                          <p>优化活动按钮文案和目标路径。</p>
                        </div>
                        <div className="form-grid">
                          <label className="field">
                            按钮文案
                            <input
                              value={section.config.action_label ?? ''}
                              disabled={!canWrite}
                              onChange={(event) => updateConfig(section.id, 'action_label', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            站内路径
                            <input
                              value={section.config.action_to ?? ''}
                              disabled={!canWrite}
                              pattern="/.*"
                              placeholder="/lottery"
                              onChange={(event) => updateConfig(section.id, 'action_to', event.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {(section.kind === 'quiz' || section.kind === 'join') && (
                      <div className="section-form-block">
                        <div className="section-form-heading">
                          <h3>入口路径</h3>
                          <p>答题与加入我们会合并为核心模块卡片；卡片按钮样式固定，这里只控制跳转路径。</p>
                        </div>
                        <label className="field section-compact-field">
                          站内路径
                          <input
                            value={section.config.action_to ?? ''}
                            disabled={!canWrite}
                            pattern="/.*"
                            placeholder={section.kind === 'quiz' ? '/quiz' : '/join'}
                            onChange={(event) => updateConfig(section.id, 'action_to', event.target.value)}
                          />
                        </label>
                      </div>
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
                            disabled={!canWrite}
                            onChange={(event) => updateSection(
                              section.id,
                              'status',
                              event.target.value as ManagedSection['status'],
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
                              disabled={!canWrite}
                              onChange={(event) => updateSection(section.id, 'starts_at', event.target.value || undefined)}
                            />
                          </label>
                          <label className="field">
                            定时结束（可选）
                            <input
                              type="datetime-local"
                              value={localDateTime(section.ends_at)}
                              disabled={!canWrite}
                              onChange={(event) => updateSection(section.id, 'ends_at', event.target.value || undefined)}
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
            <p className="muted">还没有可编排的首页区块。</p>
          )}
        </div>
      </section>
    </div>
  )
}
