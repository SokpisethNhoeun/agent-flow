// Read-only view of a worktree: branch, changed files, diff stat, recent commits, conflicts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../../../shared/commands.ts'
import { Button, Chip, EmptyState, timeAgo } from '../../components/primitives.tsx'
import { useApp } from '../../state/app-context.tsx'

type Inspection = {
  path: string
  branch: string | null
  head: string | null
  changedFiles: { status: string; path: string }[]
  diffStat: string
  commits: { hash: string; subject: string; author: string; at: number }[]
  conflicts: string[]
  ahead: number | null
  behind: number | null
}

export function GitPanel({ path }: { path: string }) {
  const { client } = useApp()
  const [data, setData] = useState<Inspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(path)
  current.current = path
  const load = useCallback(async () => {
    setError(null)
    const response = await client.transport.command({ requestId: newRequestId(), kind: 'worktree.inspect', params: { path } })
    if (current.current !== path) return
    if (response.ok) setData(response.result as Inspection)
    else setError(response.error.message)
  }, [client, path])
  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  if (error) return <EmptyState icon="branch" title="Could not inspect">{error}</EmptyState>
  if (!data) return <div className="af-empty">Reading git…</div>
  return (
    <>
      <div className="af-section">
        <dl className="af-kv">
          <dt>Path</dt>
          <dd className="af-mono">{data.path}</dd>
          <dt>Branch</dt>
          <dd className="af-mono">{data.branch ?? '—'} {data.head ? <span className="af-muted">@ {data.head}</span> : null}</dd>
          <dt>Upstream</dt>
          <dd>{data.ahead === null ? <span className="af-unavailable">No upstream</span> : `${data.ahead} ahead · ${data.behind} behind`}</dd>
        </dl>
        <div style={{ marginTop: 8 }}>
          <Button size="sm" icon="retry" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>
      {data.conflicts.length ? (
        <div className="af-section">
          <h4 style={{ color: 'var(--af-failed)' }}>Merge conflicts</h4>
          <div className="af-pre">{data.conflicts.join('\n')}</div>
        </div>
      ) : null}
      <div className="af-section">
        <h4>Changed files <span className="af-chip">{data.changedFiles.length}</span></h4>
        {data.changedFiles.length ? (
          data.changedFiles.slice(0, 200).map((file) => (
            <div key={file.path} style={{ display: 'flex', gap: 6, fontSize: 12 }} className="af-mono">
              <Chip tone={file.status.includes('D') ? 'danger' : file.status === '??' || file.status.includes('A') ? 'success' : 'warning'}>{file.status}</Chip>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>{file.path}</span>
            </div>
          ))
        ) : (
          <div className="af-muted">Working tree clean.</div>
        )}
        {data.diffStat ? <pre className="af-pre" style={{ marginTop: 8 }}>{data.diffStat}</pre> : null}
      </div>
      <div className="af-section">
        <h4>Recent commits</h4>
        {data.commits.map((commit) => (
          <div key={commit.hash} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 6 }}>
            <span className="af-mono af-muted">{commit.hash}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={commit.subject}>{commit.subject}</span>
            <span className="af-muted">{timeAgo(commit.at)}</span>
          </div>
        ))}
      </div>
    </>
  )
}
