// The AI behind an agent, shown with its bare brand mark (Simple Icons paths) in brand color;
// agents without a published mark get a monogram. Trademarks belong to their owners.
import { memo } from 'react'
import { BRAND_LOGOS, type BrandLogo } from './brand-logos.ts'

/** Orca agent id → brand mark. Antigravity is Google's agent IDE, so it uses the Gemini mark. */
const AGENT_BRAND: Record<string, string> = {
  claude: 'claude',
  codex: 'openai',
  openai: 'openai',
  gemini: 'googlegemini',
  antigravity: 'googlegemini',
  cursor: 'cursor',
  copilot: 'githubcopilot',
  windsurf: 'windsurf',
  mistral: 'mistralai',
  ollama: 'ollama',
  amp: 'amp'
}

const MONOGRAM: Record<string, { text: string; color: string }> = {
  opencode: { text: 'OC', color: '#4b5563' },
  opencode2: { text: 'OC', color: '#4b5563' },
  kiro: { text: 'K', color: '#7c3aed' },
  grok: { text: 'X', color: '#111827' },
  devin: { text: 'D', color: '#0f766e' },
  droid: { text: 'F', color: '#ea580c' },
  qwen: { text: 'Q', color: '#6d28d9' },
  'qwen-code': { text: 'Q', color: '#6d28d9' },
  kimi: { text: 'K', color: '#111827' },
  pi: { text: 'π', color: '#0369a1' }
}

/** Brands whose color is (near) black get a theme-aware tile so they stay visible in dark mode. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40
}

export function brandFor(agent: string | null | undefined): BrandLogo | null {
  if (!agent) return null
  const slug = AGENT_BRAND[agent.toLowerCase()]
  return slug ? BRAND_LOGOS[slug] ?? null : null
}

export const AgentLogo = memo(function AgentLogo({ agent, size = 32 }: { agent: string | null | undefined; size?: number; radius?: number }) {
  const brand = brandFor(agent)
  if (brand) {
    // Bare mark, no tile. Near-black brands follow the theme's text color so dark mode keeps them visible.
    const color = isDark(brand.hex) ? 'var(--af-fg)' : brand.hex
    return (
      <span className="af-logo" title={brand.title} style={{ width: size, height: size, color }}>
        <svg viewBox="0 0 24 24" width={size * 0.86} height={size * 0.86} fill="currentColor" role="img" aria-label={brand.title}>
          <path d={brand.path} />
        </svg>
      </span>
    )
  }
  const mono = (agent && MONOGRAM[agent.toLowerCase()]) || { text: (agent ?? '?').slice(0, 2).toUpperCase(), color: '#64748b' }
  return (
    <span className="af-logo mono" title={agent ?? 'Unknown agent'} style={{ width: size, height: size, color: mono.color, fontSize: size * (mono.text.length > 1 ? 0.42 : 0.56) }}>
      {mono.text}
    </span>
  )
})
