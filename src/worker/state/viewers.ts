// Knows whether anyone is looking at Agent Flow, so background scans can slow down when nobody is.
// Every request from a panel or the dashboard counts; visible UIs also ping (viewer.ping).

/** No request for this long means nobody is watching. UIs ping every 30 s while visible. */
export const VIEWER_IDLE_MS = 75_000

export class ViewerTracker {
  private lastSeen = Number.NEGATIVE_INFINITY

  constructor(
    private readonly now: () => number,
    private readonly idleAfterMs = VIEWER_IDLE_MS
  ) {}

  /** Records activity. Returns true when this ends an idle stretch (time to refresh right away). */
  touch(): boolean {
    const wasIdle = this.idle
    this.lastSeen = this.now()
    return wasIdle
  }

  get idle(): boolean {
    return this.now() - this.lastSeen > this.idleAfterMs
  }

  /** The fast interval while watched, the slow one otherwise. */
  pace(watchedMs: number, idleMs: number): number {
    return this.idle ? idleMs : watchedMs
  }
}
