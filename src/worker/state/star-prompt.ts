// A once-in-a-while "star the project on GitHub" prompt. Shown only after real use (three different
// days, at least three days after first opening), never twice in a row, and never again once the
// person starred it or said no. Kept in the plugin's own state folder, shared by every view.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const STAR_REPO_URL = 'https://github.com/SokpisethNhoeun/agent-flow'
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_DAYS_USED = 3
const MIN_AGE_MS = 3 * DAY_MS
const SNOOZE_MS = 30 * DAY_MS

export type StarAnswer = 'starred' | 'later' | 'never'
export type StarState = { firstSeen: number; days: string[]; snoozeUntil: number; done: boolean }

export const freshStarState = (now: number): StarState => ({ firstSeen: now, days: [], snoozeUntil: 0, done: false })

/** Local calendar day, so a late-night session and the next morning count as two days. */
export function dayOf(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function recordVisit(state: StarState, now: number): StarState {
  const day = dayOf(now)
  return state.days.includes(day) ? state : { ...state, days: [...state.days, day].slice(-10) }
}

export function shouldAsk(state: StarState, now: number): boolean {
  return !state.done && now >= state.snoozeUntil && state.days.length >= MIN_DAYS_USED && now - state.firstSeen >= MIN_AGE_MS
}

export function applyAnswer(state: StarState, answer: StarAnswer, now: number): StarState {
  return answer === 'later' ? { ...state, snoozeUntil: now + SNOOZE_MS } : { ...state, done: true }
}

export class StarPromptStore {
  private state: StarState | null = null
  private readonly file: string

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {
    this.file = join(dir, 'star-prompt.json')
  }

  /** Records today's visit and says whether to show the prompt now. */
  async visit(): Promise<{ show: boolean; url: string }> {
    const state = recordVisit(await this.load(), this.now())
    await this.save(state)
    return { show: shouldAsk(state, this.now()), url: STAR_REPO_URL }
  }

  async answer(answer: StarAnswer): Promise<void> {
    await this.save(applyAnswer(await this.load(), answer, this.now()))
  }

  private async load(): Promise<StarState> {
    if (this.state) return this.state
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StarState>
      this.state = {
        firstSeen: typeof raw.firstSeen === 'number' ? raw.firstSeen : this.now(),
        days: Array.isArray(raw.days) ? raw.days.filter((d): d is string => typeof d === 'string').slice(-10) : [],
        snoozeUntil: typeof raw.snoozeUntil === 'number' ? raw.snoozeUntil : 0,
        done: raw.done === true
      }
    } catch {
      this.state = freshStarState(this.now())
    }
    return this.state
  }

  private async save(state: StarState): Promise<void> {
    if (JSON.stringify(state) === JSON.stringify(this.state) && this.state) return
    this.state = state
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
    await rename(tmp, this.file)
  }
}
