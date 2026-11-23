import { useEffect, useState } from 'react'
import { api, csrfHeader } from '@core/api/client'
import ConfirmDialog from '@core/components/ConfirmDialog'

interface Qrcode {
  id: number
  title: string
  image_url: string
  active: boolean
}

export default function JoinAdmin({
  canWrite,
  onMessage,
}: {
  canWrite: boolean
  onMessage: (message: string, error?: boolean) => void
}) {
  const [items, setItems] = useState<Qrcode[]>([])
  const [titles, setTitles] = useState<Record<number, string>>({})
  const [newTitle, setNewTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Qrcode | null>(null)

  const load = async () => {
    try {
      const data = await api<{ qrcodes: Qrcode[] }>('/api/admin/qrcodes')
      const list = data.qrcodes || []
      setItems(list)
      setTitles(Object.fromEntries(list.map((item) => [item.id, item.title])))
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const uploadImage = async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/admin/uploads', {
      method: 'POST',
      headers: csrfHeader(),
      body,
    })
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
    return payload.url as string
  }

  const add = async (file: File | undefined) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    body.append('title', newTitle)
    try {
      const response = await fetch('/api/admin/qrcodes', {
        method: 'POST',
        headers: csrfHeader(),
        body,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(payload.error || `HTTP ${response.status}`)
      }
      setNewTitle('')
      onMessage('二维码已新增并默认启用，前台 30 秒内生效')
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const update = async (item: Qrcode, patch: { title?: string; image_url?: string; active?: boolean }) => {
    try {
      await api(`/api/admin/qrcodes/${item.id}`, {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      onMessage('二维码已更新')
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const replace = async (item: Qrcode, file: File | undefined) => {
    if (!file) return
    try {
      await update(item, { image_url: await uploadImage(file) })
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const remove = async (item: Qrcode) => {
    try {
      await api(`/api/admin/qrcodes/${item.id}`, { method: 'DELETE' })
      onMessage('二维码已删除')
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  if (!canWrite) return null
  return (
    <div className="admin-panel">
      <h3>加入我们 · 二维码</h3>
      <p className="muted">标题展示在二维码下方；启用中的二维码会全部出现在「加入我们」页。</p>
      <label className="field">
        新增标题（可留空，最多 30 字）
        <input value={newTitle} maxLength={30} onChange={(event) => setNewTitle(event.target.value)} />
      </label>
      <label className="field">
        上传图片（新增一条，默认启用）
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void add(file)
          }}
        />
      </label>
      <ul className="qlist">
        {items.map((item) => (
          <li key={item.id}>
            <span className="qr-row">
              <img className="thumb" src={item.image_url} alt="" />
              <input
                className="qr-title-input"
                value={titles[item.id] ?? ''}
                maxLength={30}
                onChange={(event) => setTitles({ ...titles, [item.id]: event.target.value })}
              />
            </span>
            <span className="qr-actions">
              <button className="mini-btn" type="button" onClick={() => void update(item, { title: titles[item.id] ?? '' })}>
                保存标题
              </button>
              <label className="mini-btn">
                换图
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void replace(item, file)
                  }}
                />
              </label>
              <button className="mini-btn" type="button" onClick={() => void update(item, { active: !item.active })}>
                {item.active ? '停用' : '启用'}
              </button>
              <button className="mini-btn danger" type="button" onClick={() => setPendingDelete(item)}>删除</button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="muted">暂无二维码，上传后「加入我们」页即可扫码</li>}
      </ul>
      {pendingDelete && (
        <ConfirmDialog
          title={`删除二维码「${pendingDelete.title || `#${pendingDelete.id}`}」？`}
          message="二维码记录和对应媒体文件将从后台移除。"
          details={['此操作不可恢复']}
          confirmLabel="确认删除"
          tone="danger"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const item = pendingDelete
            setPendingDelete(null)
            void remove(item)
          }}
        />
      )}
    </div>
  )
}
