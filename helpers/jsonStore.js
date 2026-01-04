const fs = require("fs/promises");
const path = require("path");

/**
 * Read JSON safely:
 * - If file missing -> return fallback
 * - If JSON corrupted -> rename to .corrupt-<timestamp> and return fallback
 */
async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    // missing file
    if (err.code === "ENOENT") return fallback;

    // corrupted JSON (or partial write)
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const corruptName = path.join(dir, `${base}.corrupt-${Date.now()}`);
    try { await fs.rename(filePath, corruptName); } catch {}

    console.error(`Corrupt JSON detected, moved to ${corruptName}:`, err);
    return fallback;
  }
}

/**
 * Atomic write:
 * - Write temp file
 * - Copy old to .bak (best-effort)
 * - Rename temp -> real
 */
async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.tmp`);
  const bakPath = path.join(dir, `${base}.bak`);

  const payload = JSON.stringify(data, null, 2);

  // best-effort backup of previous good file
  try {
    await fs.copyFile(filePath, bakPath);
  } catch {}

  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, filePath); // atomic on same filesystem
}

/**
 * Simple per-file queue so writes can't overlap.
 */
const queues = new Map();
function withFileLock(filePath, fn) {
  const prev = queues.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(filePath, next.finally(() => {
    if (queues.get(filePath) === next) queues.delete(filePath);
  }));
  return next;
}

module.exports = {
  readJsonSafe,
  writeJsonAtomic,
  withFileLock,
};
