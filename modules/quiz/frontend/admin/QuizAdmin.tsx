import { useEffect, useMemo, useState } from 'react'
import { api, csrfHeader } from '@core/api/client'

interface Question {
  id: number
  content: string
  options: string[]
  answer: number
  score: number
  active: boolean
  difficulty: string
}

interface QuizAdminProps {
  canWrite: boolean
  onMessage: (message: string, error?: boolean) => void
}

export default function QuizAdmin({ canWrite, onMessage }: QuizAdminProps) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('全部')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [content, setContent] = useState('')
  const [options, setOptions] = useState('')
  const [answer, setAnswer] = useState(0)
  const [score, setScore] = useState(10)
  const [newDifficulty, setNewDifficulty] = useState('简单')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api<{ questions: Question[] }>('/api/admin/questions')
      setQuestions(data.questions)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const draftOptions = options.split('\n').map((option) => option.trim()).filter(Boolean)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return questions.filter((question) => {
      if (difficulty !== '全部' && question.difficulty !== difficulty) return false
      if (status === 'active' && !question.active) return false
      if (status === 'inactive' && question.active) return false
      return !needle || question.content.toLocaleLowerCase('zh-CN').includes(needle)
    })
  }, [difficulty, query, questions, status])

  const download = async (path: string, name: string) => {
    const response = await fetch(path)
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      throw new Error(payload.error || `HTTP ${response.status}`)
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = name
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const createQuestion = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify({
          content,
          options: draftOptions,
          answer,
          score,
          difficulty: newDifficulty,
        }),
      })
      setContent('')
      setOptions('')
      setAnswer(0)
      onMessage('题目已添加')
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const importQuestions = async (file: File | undefined) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    try {
      const response = await fetch('/api/admin/questions/import', {
        method: 'POST',
        headers: csrfHeader(),
        body,
      })
      const payload = await response.json().catch(() => ({ error: '导入失败' }))
      if (!response.ok) throw new Error(payload.error || '导入失败')
      const failed = (payload.failed || []) as Array<{ line: number; error: string }>
      onMessage(failed.length
        ? `导入完成：成功 ${payload.imported} 题；失败 ${failed.length} 行`
        : `导入成功：${payload.imported} 题`, failed.length > 0)
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const clearQuestions = async () => {
    if (!window.confirm(`确定清空全部 ${questions.length} 道题目？答题记录和排行榜会保留。`)) return
    try {
      const result = await api<{ questions_deleted: number }>('/api/admin/questions', {
        method: 'DELETE',
      })
      onMessage(`已清空 ${result.questions_deleted} 道题目（排行榜与答题记录保留）`)
      await load()
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  return (
    <div className="card">
      <div className="qbank-head">
        <div>
          <h3>题库（{questions.length}）</h3>
          <p className="muted">启用中 {questions.filter((question) => question.active).length} 题 · 当前筛选 {filtered.length} 题</p>
        </div>
        {canWrite && (
          <button className="mini-btn danger" type="button" onClick={() => void clearQuestions()}>
            一键清空题库
          </button>
        )}
      </div>
      <div className="admin-grid">
        {canWrite && (
          <div className="admin-panel question-import-panel">
            <h3>批量导入题目</h3>
            <p className="muted">CSV 列：题目, 选项A~F, 正确答案(A-F), 难度, 分值。</p>
            <div className="field-actions">
              <button
                className="btn"
                type="button"
                onClick={() => void download('/api/admin/questions/template', 'questions-template.csv').catch((cause) => {
                  onMessage((cause as Error).message, true)
                })}
              >
                下载模板
              </button>
              <label className="field">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void importQuestions(file)
                  }}
                />
              </label>
            </div>
          </div>
        )}
        {canWrite && (
          <div className="admin-panel">
            <h3>新增题目</h3>
            <label className="field">
              题目
              <input value={content} onChange={(event) => setContent(event.target.value)} />
            </label>
            <label className="field">
              选项（每行一个）
              <textarea rows={4} value={options} onChange={(event) => setOptions(event.target.value)} />
            </label>
            <label className="field">
              正确答案
              <select value={answer} disabled={draftOptions.length === 0} onChange={(event) => setAnswer(Number(event.target.value))}>
                {draftOptions.map((option, index) => (
                  <option key={`${index}-${option}`} value={index}>{String.fromCharCode(65 + index)}. {option}</option>
                ))}
              </select>
            </label>
            <label className="field">
              分值
              <input type="number" min={1} value={score} onChange={(event) => setScore(Number(event.target.value))} />
            </label>
            <label className="field">
              难度
              <select value={newDifficulty} onChange={(event) => setNewDifficulty(event.target.value)}>
                {['容易', '简单', '困难'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || !content.trim() || draftOptions.length < 2 || answer >= draftOptions.length || score < 1}
              onClick={() => void createQuestion()}
            >
              添加题目
            </button>
          </div>
        )}
        <div className="admin-panel">
          <h3>题目列表</h3>
          <div className="question-filters">
            <label className="field">
              搜索题目
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="field">
              难度
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                {['全部', '容易', '简单', '困难'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field">
              状态
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="all">全部</option>
                <option value="active">启用中</option>
                <option value="inactive">已停用</option>
              </select>
            </label>
          </div>
          {loading ? (
            <div className="admin-loading" role="status">正在读取题库…</div>
          ) : (
            <ul className="qlist">
              {filtered.map((question) => (
                <li key={question.id} title={question.content}>
                  <span className={question.active ? '' : 'muted'}>
                    <i className={`qdiff d-${question.difficulty}`}>{question.difficulty}</i>
                    {' '}#{question.id} {question.content.slice(0, 24)}
                  </span>
                  {canWrite && (
                    <button
                      className="mini-btn"
                      type="button"
                      onClick={() => {
                        void api(`/api/admin/questions/${question.id}/active`, {
                          method: 'POST',
                          body: JSON.stringify({ active: !question.active }),
                        }).then(load).then(() => {
                          onMessage(question.active ? '题目已停用' : '题目已启用')
                        }).catch((cause) => onMessage((cause as Error).message, true))
                      }}
                    >
                      {question.active ? '停用' : '启用'}
                    </button>
                  )}
                </li>
              ))}
              {filtered.length === 0 && <li className="muted">没有符合当前筛选条件的题目。</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
