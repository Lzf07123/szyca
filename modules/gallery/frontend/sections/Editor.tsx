import { useCallback, useEffect, useState } from 'react'
import type { SiteGalleryImage } from '@core/api/site'
import { api, csrfHeader } from '@core/api/client'
import type { SectionEditorProps } from '@core/site-sections/contract'

interface GalleryResponse {
  images: SiteGalleryImage[]
}

type GalleryImagePayload = SiteGalleryImage | { image: SiteGalleryImage }

function galleryImageFrom(payload: GalleryImagePayload | { error?: string }): SiteGalleryImage {
  if ('image' in payload) return payload.image
  if ('id' in payload) return payload
  throw new Error(('error' in payload && payload.error) || '图片接口返回格式无效')
}

async function uploadImage(sectionID: number, file: File): Promise<SiteGalleryImage> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`/api/admin/gallery/${sectionID}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrfHeader(),
    body,
  })
  let payload: GalleryImagePayload | { error?: string } = { error: '图片接口返回为空' }
  try {
    payload = await response.json()
  } catch {
    // Empty/non-JSON responses fall through to the status check.
  }
  if (!response.ok) {
    throw new Error(('error' in payload && payload.error) || `HTTP ${response.status}`)
  }
  return galleryImageFrom(payload)
}

export default function GalleryEditor({
  section,
  canWrite,
  onChanged,
}: SectionEditorProps) {
  const [images, setImages] = useState<SiteGalleryImage[]>(section.gallery ?? [])
  const [loading, setLoading] = useState(section.id > 0)
  const [busyID, setBusyID] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (section.id <= 0) {
      setImages([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await api<GalleryResponse>(`/api/admin/gallery/${section.id}/images`)
      setImages(data.images ?? [])
    } catch (cause) {
      setMessage((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [section.id])

  useEffect(() => {
    void load()
  }, [load])

  const onUpload = async (files: FileList | null) => {
    if (!files?.length || !canWrite || section.id <= 0) return
    const capacity = Math.max(0, 4 - images.length)
    if (capacity === 0) {
      setMessage('每个活动影像实例最多 4 张图片')
      return
    }
    const selected = Array.from(files).slice(0, capacity)
    setUploading(true)
    setMessage('')
    try {
      const uploaded: SiteGalleryImage[] = []
      for (const file of selected) {
        uploaded.push(await uploadImage(section.id, file))
      }
      setImages((current) => [...current, ...uploaded])
      await onChanged()
      setMessage(
        selected.length < files.length
          ? `已上传 ${uploaded.length} 张；每个实例最多 4 张`
          : `已上传 ${uploaded.length} 张活动影像`,
      )
    } catch (cause) {
      setMessage((cause as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const saveTitle = async (image: SiteGalleryImage) => {
    if (!canWrite) return
    setBusyID(image.id)
    setMessage('')
    try {
      const data = await api<GalleryImagePayload>(
        `/api/admin/gallery/${section.id}/images/${image.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ title: image.title }),
        },
      )
      setImages((current) => current.map((candidate) => (
        candidate.id === image.id ? galleryImageFrom(data) : candidate
      )))
      await onChanged()
      setMessage('图片说明已保存')
    } catch (cause) {
      setMessage((cause as Error).message)
    } finally {
      setBusyID(null)
    }
  }

  const deleteImage = async (image: SiteGalleryImage) => {
    if (!canWrite || !window.confirm(`确认删除「${image.title || '未命名图片'}」？`)) return
    setBusyID(image.id)
    setMessage('')
    try {
      await api(`/api/admin/gallery/${section.id}/images/${image.id}`, { method: 'DELETE' })
      setImages((current) => current.filter((candidate) => candidate.id !== image.id))
      await onChanged()
      setMessage('图片已删除')
    } catch (cause) {
      setMessage((cause as Error).message)
    } finally {
      setBusyID(null)
    }
  }

  const moveImage = async (imageID: number, direction: -1 | 1) => {
    const index = images.findIndex((image) => image.id === imageID)
    const target = index + direction
    if (index < 0 || target < 0 || target >= images.length || !canWrite) return
    const reordered = [...images]
    reordered[index] = images[target]
    reordered[target] = images[index]
    setImages(reordered)
    setBusyID(imageID)
    setMessage('')
    try {
      const data = await api<GalleryResponse>(`/api/admin/gallery/${section.id}/images/order`, {
        method: 'PUT',
        body: JSON.stringify({ ids: reordered.map((image) => image.id) }),
      })
      setImages(data.images ?? reordered)
      await onChanged()
    } catch (cause) {
      setMessage((cause as Error).message)
      await load()
    } finally {
      setBusyID(null)
    }
  }

  return (
    <div className="section-form-block gallery-manager">
      <div className="section-form-heading">
        <h3>活动图片</h3>
        <p>图片文件由媒体模块保管；这里管理图集顺序和图片说明。</p>
      </div>
      {section.id <= 0 ? (
        <div className="read-only-note" role="status">
          请先保存首页编排，创建真实 Section 后再上传活动图片。
        </div>
      ) : (
        <>
          <label className="gallery-upload-control">
            <span>{uploading ? '正在上传…' : '上传活动图片'}</span>
            <small>支持 JPG / PNG / WebP / GIF，单张不超过 10MB，可多选。</small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={!canWrite || uploading}
              onChange={(event) => {
                void onUpload(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
          {loading ? (
            <p className="muted" role="status">正在读取图集…</p>
          ) : images.length === 0 ? (
            <p className="muted">还没有活动图片。</p>
          ) : (
            <div className="gallery-admin-list">
              {images.map((image, index) => (
                <article className="gallery-admin-item" key={image.id}>
                  <img src={image.image_url} alt="" />
                  <div className="gallery-admin-fields">
                    <label className="field">
                      图片说明
                      <input
                        value={image.title}
                        maxLength={120}
                        disabled={!canWrite || busyID === image.id}
                        onChange={(event) => {
                          const title = event.target.value
                          setImages((current) => current.map((candidate) => (
                            candidate.id === image.id ? { ...candidate, title } : candidate
                          )))
                        }}
                      />
                    </label>
                    <div className="gallery-admin-actions">
                      <button
                        className="mini-btn"
                        type="button"
                        disabled={!canWrite || index === 0 || busyID !== null}
                        onClick={() => void moveImage(image.id, -1)}
                      >
                        上移
                      </button>
                      <button
                        className="mini-btn"
                        type="button"
                        disabled={!canWrite || index === images.length - 1 || busyID !== null}
                        onClick={() => void moveImage(image.id, 1)}
                      >
                        下移
                      </button>
                      <button
                        className="mini-btn"
                        type="button"
                        disabled={!canWrite || busyID !== null}
                        onClick={() => void saveTitle(image)}
                      >
                        保存说明
                      </button>
                      <button
                        className="mini-btn danger"
                        type="button"
                        disabled={!canWrite || busyID !== null}
                        onClick={() => void deleteImage(image)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {message && <p className="gallery-admin-message" role="status">{message}</p>}
    </div>
  )
}
