// Today's telephone traffic, bucketed across the day so the board can draw the
// ebb and flow of the exhibit.
//
// One counter per 15-minute slice of local time (96 a day). A call is counted
// once, when it starts. The day rolls over at local midnight — not UTC, and not
// 24h after boot — so the graph always reads as "today".
//
// The counts are written to disk because the service is restarted by the
// watchdog and by updates; without that, a restart at 2pm would erase the
// morning and make a busy day look dead.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { EventEmitter } from 'node:events';

export const BUCKET_MINUTES = 15;
export const BUCKETS = (24 * 60) / BUCKET_MINUTES;

// Local calendar day, e.g. "2026-08-10". Local on purpose: the exhibit's day is
// the visitors' day.
function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bucketOf(d = new Date()) {
  return Math.min(BUCKETS - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / BUCKET_MINUTES));
}

export class DailyTraffic extends EventEmitter {
  constructor(path, { saveDebounceMs = 5000 } = {}) {
    super();
    this.path = path;
    this.saveDebounceMs = saveDebounceMs;
    this.saveTimer = null;
    this.day = dayKey();
    this.counts = new Array(BUCKETS).fill(0);
    this._load();

    // Rolls the day over while the exhibit is idle, and keeps "now" moving on
    // the graph even when nothing is happening.
    this.rollTimer = setInterval(() => this.rollIfNeeded(), 60000);
    this.rollTimer.unref?.();
  }

  _load() {
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      if (saved?.day !== dayKey()) return; // yesterday's file: start clean
      if (!Array.isArray(saved.counts) || saved.counts.length !== BUCKETS) return;
      this.counts = saved.counts.map((n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0));
      console.log(`[traffic] resumed today's counts (${this.total()} calls so far)`);
    } catch {
      // No file, or an unreadable one — today simply starts at zero.
    }
  }

  _save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        // Write-then-rename: a power cut can't leave a half-written file that
        // would throw away the day on the next boot.
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, JSON.stringify({ day: this.day, counts: this.counts }));
        renameSync(tmp, this.path);
      } catch (err) {
        console.warn('[traffic] could not save:', err.message);
      }
    }, this.saveDebounceMs);
    this.saveTimer.unref?.();
  }

  rollIfNeeded(now = new Date()) {
    const key = dayKey(now);
    if (key === this.day) return false;
    console.log(`[traffic] new day (${key}) — counters reset`);
    this.day = key;
    this.counts = new Array(BUCKETS).fill(0);
    this._save();
    this.emit('change');
    return true;
  }

  record(now = new Date()) {
    this.rollIfNeeded(now);
    this.counts[bucketOf(now)]++;
    this._save();
    this.emit('change');
  }

  total() {
    return this.counts.reduce((a, b) => a + b, 0);
  }

  snapshot(now = new Date()) {
    return {
      day: this.day,
      bucketMinutes: BUCKET_MINUTES,
      counts: this.counts,
      total: this.total(),
      peak: Math.max(0, ...this.counts),
      nowBucket: bucketOf(now),
    };
  }

  stop() {
    clearInterval(this.rollTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}
