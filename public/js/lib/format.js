/* ═══════════════════════════════════════════════════════
   Formatting numbers, sizes, durations and dates for display.
   ═══════════════════════════════════════════════════════ */

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @param {number} [dp=1]
 */
function fmtBytes(bytes, dp = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dp)) + ' ' + sizes[i];
}

/**
 * Format a large count to compact form (1.2K, 3.4M).
 * @param {number} n
 */
function fmtNumber(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/**
 * Format a duration in seconds as "3d 4h 12m" (short, human-readable).
 * @param {number} sec
 */
function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Format a date string to short locale format.
 * @param {string} dateStr
 */
function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false });
  } catch { return dateStr; }
}
