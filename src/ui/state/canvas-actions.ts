import { createContext } from 'react'

/** Actions nodes can trigger without prop drilling through React Flow. */
export type CanvasActions = {
  toggleCollapsed: (id: string, current?: boolean) => void
  resizeBox?: (projectKey: string, size: { width: number; height: number }) => void
}

export const CanvasActionsContext = createContext<CanvasActions>({ toggleCollapsed: () => undefined })
