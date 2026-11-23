import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface MediaRef {
  module: string
  resource_type: string
  resource_id: string
}

interface Asset {
  id: number
  path: string
  mime: string
  width?: number
  height?: number
  checksum: string
  refs: MediaRef[]
  created_at: string
}

export default function MediaPanel({
  canWrite,
  onMessage,
}: {
  canWrite: boolean
  onMessage: (message: string, error?: boolean) => void
}) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await api<{ assets: Asset[] }>('/api/admin/media')
      setAssets(data.assets)
    } catch (cause) {
      const message = (cause as Error).message || '媒体资源读取失败'
      setLoadError(message)
      onMessage(message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const remove = async (asset: Asset) => {
    if (asset.refs.length > 0) return
    if (!window.confirm(`确定删除 ${asset.path}？文件将从数据卷移除。`)) return
    try {
      await api(`/api/admin/media/${asset.id}`, { method: 'DELETE' })
      await load()
      onMessage('未被引用的媒体已删除')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  return (
    <div className="admin-panel media-panel">
      <div className="panel-head">
        <div>
          <h3>媒体资源台账</h3>
          <p className="muted">Logo、二维码、页脚图标和背景共用同一份引用记录；使用中的文件不能直接删除。</p>
        </div>
        <button className="mini-btn" type="button" onClick={() => void load()}>刷新</button>
      </div>
      {loadError ? (
        <div className="admin-inline-error">
          <p>{loadError}</p>
          <button className="mini-btn" type="button" onClick={() => void load()}>重新读取</button>
        </div>
      ) : loading ? (
        <div className="admin-loading" role="status">正在读取媒体资源…</div>
      ) : (
        <div className="media-list">
          {assets.map((asset) => (
            <div className="media-row" key={asset.id}>
              {asset.mime.startsWith('image/') ? (
                <img src={asset.path} alt="" loading="lazy" />
              ) : (
                <span className="media-placeholder" aria-hidden="true">FILE</span>
              )}
              <span className="media-main">
                <strong>{asset.path.split('/').pop()}</strong>
                <small>{asset.mime}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</small>
                <small className="media-checksum">SHA-256 {asset.checksum.slice(0, 16) || '—'}</small>
              </span>
              <span className="media-refs">
                {asset.refs.length > 0
                  ? asset.refs.map((ref) => (
                    <span key={`${ref.module}-${ref.resource_type}-${ref.resource_id}`}>
                      {ref.resource_type} #{ref.resource_id}
                    </span>
                  ))
                  : <span>未引用</span>}
              </span>
              {canWrite && (
                <button
                  className="mini-btn danger"
                  type="button"
                  disabled={asset.refs.length > 0}
                  title={asset.refs.length > 0 ? '先解除所有引用' : '删除文件'}
                  onClick={() => void remove(asset)}
                >
                  {asset.refs.length > 0 ? '使用中' : '删除'}
                </button>
              )}
            </div>
          ))}
          {assets.length === 0 && <p className="muted">暂无媒体资源。</p>}
        </div>
      )}
    </div>
  )
}
