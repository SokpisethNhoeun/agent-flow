// Boots the one UI bundle on any surface: sidebar panel, canvas editor, browser dashboard.
import '@xyflow/react/dist/style.css'
import './styles/app.css'
import './styles/canvas.css'
import './styles/chat.css'
import './styles/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { AppProvider, type Surface } from './state/app-context.tsx'
import { documentPersistence } from './state/document-persistence.ts'
import { setAsyncLayouter } from './graph/layout-cache.ts'
// Imported here, by the entry, so it lands in app.js and its worker URL resolves next to it.
import { createWorkerLayouter } from './graph/layout-worker-client.ts'

setAsyncLayouter(createWorkerLayouter())
import { FlowClient } from './state/flow-client.ts'
import { localStoragePersistence, ViewStore, type ViewPersistence } from './state/view-store.ts'
import { createHttpTransport, readToken } from './transport/http-transport.ts'
import { createOrcaTransport, orcaFrame } from './transport/orca-transport.ts'
import type { Transport } from './transport/types.ts'

async function boot(): Promise<void> {
  const root = document.getElementById('root')!
  const surface = (document.documentElement.dataset.surface as Surface | undefined) ?? 'panel'
  let transport: Transport
  const frame = orcaFrame()
  const inOrca = Boolean(frame) && surface !== 'dashboard'
  if (inOrca) transport = createOrcaTransport(frame!)
  else {
    const token = readToken()
    if (!token) {
      root.innerHTML = '<div class="af-empty"><h3>Missing access token</h3><div>Open the dashboard with the link from Orca: run “Agent Flow: Show browser dashboard link” from the command palette.</div></div>'
      return
    }
    transport = createHttpTransport(token)
  }
  // Ask for data first; the view settings (possibly the .agentflow document) load meanwhile.
  const client = new FlowClient(transport)
  client.start()
  const persistence: ViewPersistence = inOrca
    ? surface === 'canvas'
      ? await documentPersistence()
      : localStoragePersistence('agent-flow:panel-view')
    : localStoragePersistence('agent-flow:dashboard-view')
  const viewStore = new ViewStore(surface === 'panel', persistence)
  await viewStore.hydrate()
  createRoot(root).render(
    <StrictMode>
      <AppProvider client={client} viewStore={viewStore} surface={surface}>
        <App />
      </AppProvider>
    </StrictMode>
  )
}

void boot()
