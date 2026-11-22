// "Agent Flow 0.1.6 is available": a slim banner under the toolbar when a newer release is out (the
// worker checks GitHub every 6 hours, installed copies only). Update runs Orca's `orca plugin update`;
// a version that needs new access shows Orca's approve command to copy instead.
import { useEffect, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import { useApp } from '../state/app-context.tsx'
import { Dialog } from './overlays.tsx'
import { Button } from './primitives.tsx'

type Info = { current: string; latest: string | null; newer: boolean; releaseUrl: string | null }
type Result = { updated: true; version: string | null } | { updated: false; approveCommand: string | null; reason: string }

const RECHECK_MS = 6 * 60 * 60 * 1000
const laterKey = (version: string) => `agent-flow:update-later:${version}`

function snoozed(version: string): boolean {
  try {
    return Number(localStorage.getItem(laterKey(version)) ?? 0) > Date.now()
  } catch {
    return false
  }
}

export function UpdateNotice() {
  const { client, toast, openDialog } = useApp()
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const check = () =>
      void client.transport.command({ requestId: newRequestId(), kind: 'update.check', params: {} }).then((response) => {
        if (alive && response.ok) setInfo(response.result as Info)
      })
    check()
    const timer = setInterval(check, RECHECK_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [client])

  if (!info?.newer || !info.latest || snoozed(info.latest)) return null
  const latest = info.latest
  const later = () => {
    try {
      localStorage.setItem(laterKey(latest), String(Date.now() + 24 * 60 * 60 * 1000))
    } catch {
      // storage may be blocked; hide for this session only
    }
    setInfo({ ...info, newer: false })
  }
  const update = async () => {
    setBusy(true)
    const response = await client.transport.command({ requestId: newRequestId(), kind: 'update.run', params: {} })
    setBusy(false)
    if (!response.ok) return toast(`Update: ${response.error.message}`, 'failed')
    const result = response.result as Result
    if (result.updated) {
      toast(`Agent Flow updated to ${result.version ?? latest}. It restarts in a moment.`, 'done')
      setInfo({ ...info, newer: false })
      return
    }
    if (!result.approveCommand) return toast(`Update: ${result.reason}`, 'failed')
    const command = result.approveCommand
    openDialog((close) => (
      <Dialog
        title={`Approve Agent Flow ${latest}`}
        onClose={close}
        footer={
          <>
            <Button onClick={close}>Close</Button>
            <Button
              variant="primary"
              icon="copy"
              onClick={() => {
                const area = document.getElementById('af-update-cmd') as HTMLTextAreaElement | null
                area?.select()
                if (document.execCommand?.('copy')) toast('Command copied', 'done')
              }}
            >
              Copy command
            </Button>
          </>
        }
      >
        <div className="af-note warn">{result.reason} Run this in a terminal inside Orca (on Linux outside Orca, use <code>orca-ide</code> instead of <code>orca</code>). Orca lists the new access before you approve.</div>
        <textarea id="af-update-cmd" className="af-textarea" readOnly rows={3} value={command} onFocus={(e) => e.currentTarget.select()} />
      </Dialog>
    ))
  }
  return (
    <div className="af-banner af-update" role="status">
      <span>
        <b>Agent Flow {latest}</b> is available <span className="af-muted">(you have {info.current})</span>
      </span>
      {info.releaseUrl ? (
        <Button size="sm" variant="ghost" onClick={() => void client.transport.openExternal?.(info.releaseUrl!)}>
          What's new
        </Button>
      ) : null}
      <Button size="sm" variant="primary" icon="download" disabled={busy} onClick={() => void update()}>
        {busy ? 'Updating…' : 'Update'}
      </Button>
      <Button size="sm" variant="ghost" onClick={later}>Later</Button>
    </div>
  )
}
