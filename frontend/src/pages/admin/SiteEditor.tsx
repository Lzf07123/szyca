import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { SectionConfig, SiteFeature } from '../../api/site'

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

function localDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
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
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [sectionData, featureData] = await Promise.all([
        api<{ sections: ManagedSection[] }>('/api/admin/site/sections'),
        api<{ features: SiteFeature[] }>('/api/admin/platform/features'),
      ])
      setSections(sectionData.sections)
      setFeatures(featureData.features)
      setDirty(false)
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
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

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
    setDirty(true)
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, [key]: value } : section
    )))
  }

  const updateConfig = (id: number, key: keyof SectionConfig, value: string) => {
    setDirty(true)
    setSections((current) => current.map((section) => (
      section.id === id ? { ...section, config: { ...section.config, [key]: value } } : section
    )))
  }

  const saveSections = async () => {
    if (!canWrite || saving) return
    setSaving(true)
    try {
      await api('/api/admin/site/sections', {
        method: 'PUT',
        body: JSON.stringify({
          sections: sections.map((section) => ({
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
      await load()
      setDirty(false)
      onMessage('首页 Section 已保存，公开端无需重新构建')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setSaving(false)
    }
  }

  const saveFeatures = async () => {
    if (!canWrite || saving) return
    const editable = features.filter((feature) => (
      feature.key !== 'lottery' || canManageLottery
    ))
    setSaving(true)
    try {
      await api('/api/admin/platform/features', {
        method: 'PUT',
        body: JSON.stringify({ features: editable }),
      })
      await onSaved()
      await load()
      setDirty(false)
      onMessage('模块开关已保存')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="admin-loading" role="status">正在读取站点配置…</div>

  return (
    <div className="admin-stack">
      {!canWrite && (
        <div className="read-only-note" role="status">
          当前角色可查看站点配置，但没有编辑与发布权限。
        </div>
      )}
      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">MODULE SWITCHES</p>
            <h2>公开模块开关</h2>
          </div>
        </div>
        <div className="feature-switch-grid">
          {features.map((feature) => {
            const editable = canWrite && (feature.key !== 'lottery' || canManageLottery)
            const labels: Record<SiteFeature['key'], string> = {
              quiz: '答题',
              lottery: '抽奖',
              join: '加入我们',
              screen: '排行榜',
            }
            return (
              <label className="feature-switch" key={feature.key}>
                <span>
                  <strong>{labels[feature.key]}</strong>
                  <small>{feature.enabled ? '公开端可见' : '入口与接口关闭'}</small>
                </span>
                <input
                  type="checkbox"
                  checked={feature.enabled}
                  disabled={!editable}
                  onChange={(event) => {
                    setDirty(true)
                    setFeatures((current) => current.map((item) => (
                      item.key === feature.key ? { ...item, enabled: event.target.checked } : item
                    )))
                  }}
                />
              </label>
            )
          })}
        </div>
        {canWrite && (
          <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void saveFeatures()}>
            {saving ? '保存中…' : '保存模块开关'}
          </button>
        )}
      </section>

      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">HOMEPAGE COMPOSITION</p>
            <h2>首页 Section</h2>
          {dirty && <span className="status-chip unsaved">有未保存修改</span>}
          </div>
          {canWrite && (
            <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void saveSections()}>
              {saving ? '保存中…' : '保存全部'}
            </button>
          )}
        </div>
        <p className="muted">固定类型、纯文本配置；支持排序、启停、草稿/发布和定时上下线。</p>
        <div className="section-editor-list">
          {sections.map((section) => (
            <article className="section-editor" key={section.id}>
              <header>
                <div>
                  <span className="kind-chip">{section.kind}</span>
                  <strong>Section #{section.id}</strong>
                </div>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={section.enabled}
                    disabled={!canWrite}
                    onChange={(event) => updateSection(section.id, 'enabled', event.target.checked)}
                  />
                  启用
                </label>
              </header>
              <div className="form-grid">
                <label className="field">
                  顺序
                  <input
                    type="number"
                    value={section.sort}
                    disabled={!canWrite}
                    onChange={(event) => updateSection(section.id, 'sort', Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  状态
                  <select
                    value={section.status}
                    disabled={!canWrite}
                    onChange={(event) => updateSection(section.id, 'status', event.target.value as ManagedSection['status'])}
                  >
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                    <option value="archived">已归档</option>
                  </select>
                </label>
                <label className="field">
                  开始时间
                  <input
                    type="datetime-local"
                    value={localDateTime(section.starts_at)}
                    disabled={!canWrite}
                    onChange={(event) => updateSection(section.id, 'starts_at', event.target.value || undefined)}
                  />
                </label>
                <label className="field">
                  结束时间
                  <input
                    type="datetime-local"
                    value={localDateTime(section.ends_at)}
                    disabled={!canWrite}
                    onChange={(event) => updateSection(section.id, 'ends_at', event.target.value || undefined)}
                  />
                </label>
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
              <label className="field">
                正文 / 副标题
                <textarea
                  rows={3}
                  value={section.config.body ?? section.config.subtitle ?? ''}
                  disabled={!canWrite}
                  maxLength={1000}
                  onChange={(event) => updateConfig(section.id, section.kind === 'hero' ? 'subtitle' : 'body', event.target.value)}
                />
              </label>
              {(section.config.action_to || section.kind === 'quiz' || section.kind === 'lottery' || section.kind === 'join') && (
                <div className="form-grid">
                  <label className="field">
                    按钮文案
                    <input
                      value={section.config.action_label ?? section.config.primary_label ?? ''}
                      disabled={!canWrite}
                      onChange={(event) => updateConfig(
                        section.id,
                        section.kind === 'hero' ? 'primary_label' : 'action_label',
                        event.target.value,
                      )}
                    />
                  </label>
                  <label className="field">
                    站内路径
                    <input
                      value={section.config.action_to ?? section.config.primary_to ?? ''}
                      disabled={!canWrite}
                      pattern="/.*"
                      onChange={(event) => updateConfig(
                        section.id,
                        section.kind === 'hero' ? 'primary_to' : 'action_to',
                        event.target.value,
                      )}
                    />
                  </label>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
