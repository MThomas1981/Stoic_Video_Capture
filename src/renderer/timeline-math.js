// Time and frame helpers for the editor. Loaded in the browser as
// window.TimelineMath and in tests via require().

(function (root) {
  const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

  function frameAt(t, fps) {
    return Math.max(0, Math.floor(t * fps + 1e-6));
  }

  /** Seek target for a frame: a quarter into it, so the decoder lands on it. */
  function timeOfFrame(frame, fps) {
    return (frame + 0.25) / fps;
  }

  /** H:MM:SS:FF (frames), the standard editing timecode. */
  function timecode(t, fps) {
    const f = frameAt(t, fps);
    const r = Math.round(fps) || 30;
    const totalSec = Math.floor(f / fps + 1e-6);
    const ff = f - Math.round(totalSec * fps);
    return `${Math.floor(totalSec / 3600)}:${pad((totalSec % 3600) / 60)}:${pad(totalSec % 60)}:${pad(Math.max(0, Math.min(r - 1, ff)))}`;
  }

  /** m:ss.cc for lists and labels. */
  function short(t) {
    const s = Math.max(0, t);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const body = `${h ? `${h}:${pad(m)}` : m}:${sec.toFixed(2).padStart(5, '0')}`;
    return body;
  }

  /** YouTube-style chapter time: m:ss or h:mm:ss. */
  function chapterTime(t) {
    const s = Math.floor(Math.max(0, t));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  /**
   * Accepts "f120" (frame), "1:02:03:15" (timecode), "1:02:03.5", "2:30", "75.5".
   * Returns seconds, or null if it can't be read.
   */
  function parseTime(text, fps) {
    const s = String(text).trim().toLowerCase();
    if (!s) return null;
    if (/^f\d+$/.test(s)) return timeOfFrame(Number(s.slice(1)), fps);
    const parts = s.split(':');
    if (parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
    const n = parts.map(Number);
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] * 60 + n[1];
    if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
    if (n.length === 4) return n[0] * 3600 + n[1] * 60 + n[2] + timeOfFrame(n[3], fps) - 0.25 / fps;
    return null;
  }

  function effectiveClips(clips, duration) {
    return clips && clips.length ? clips : [{ start: 0, end: duration }];
  }

  /** Where a moment of the recording ends up in the exported video (null if cut out). */
  function sourceToOutput(t, clips, speed, duration) {
    let acc = 0;
    for (const c of effectiveClips(clips, duration)) {
      if (t >= c.start && t <= c.end) return (acc + (t - c.start)) / speed;
      acc += c.end - c.start;
    }
    return null;
  }

  /** The recording moment shown at output time `t`. */
  function outputToSource(t, clips, speed, duration) {
    let remaining = t * speed;
    const list = effectiveClips(clips, duration);
    for (const c of list) {
      const len = c.end - c.start;
      if (remaining <= len) return c.start + remaining;
      remaining -= len;
    }
    return list[list.length - 1].end;
  }

  function outputDuration(clips, speed, duration) {
    return effectiveClips(clips, duration).reduce((s, c) => s + (c.end - c.start), 0) / speed;
  }

  /** YouTube chapters text from markers, in exported-video time. */
  function chaptersText(markers, clips, speed, duration) {
    const rows = markers
      .map((m) => ({ t: sourceToOutput(m.time, clips, speed, duration), label: m.label || 'Chapter' }))
      .filter((r) => r.t !== null)
      .sort((a, b) => a.t - b.t);
    // YouTube requires the first chapter at 0:00.
    if (!rows.length || chapterTime(rows[0].t) !== '0:00') rows.unshift({ t: 0, label: 'Start' });
    return rows.map((r) => `${chapterTime(r.t)} ${r.label}`).join('\n');
  }

  const api = {
    frameAt, timeOfFrame, timecode, short, chapterTime, parseTime,
    sourceToOutput, outputToSource, outputDuration, chaptersText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimelineMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
