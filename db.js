import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/app/data/images.db'
  : path.join(__dirname, 'images.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    ic_id       TEXT PRIMARY KEY,
    ic_link     TEXT NOT NULL,
    ic_url      TEXT NOT NULL,
    type        TEXT NOT NULL,
    source_url  TEXT UNIQUE,
    title       TEXT DEFAULT '',
    source      TEXT DEFAULT '',
    likes       INTEGER DEFAULT 0,
    superlikes  INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_images_type      ON images(type);
  CREATE INDEX IF NOT EXISTS idx_images_superlikes ON images(superlikes DESC);
  CREATE INDEX IF NOT EXISTS idx_images_likes      ON images(likes DESC);
`);

// ── Prepared statements ────────────────────────────────────────────────────────

const stmtGetBySourceUrl = db.prepare(
  'SELECT * FROM images WHERE source_url = ?'
);

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO images
    (ic_id, ic_link, ic_url, type, source_url, title, source)
  VALUES
    (@ic_id, @ic_link, @ic_url, @type, @source_url, @title, @source)
`);

const stmtIncrementLikes = db.prepare(
  'UPDATE images SET likes = likes + 1 WHERE ic_id = ?'
);

const stmtIncrementSuperlikes = db.prepare(
  'UPDATE images SET superlikes = superlikes + 1 WHERE ic_id = ?'
);

const stmtTopSuperlikes = db.prepare(
  'SELECT * FROM images WHERE superlikes > 0 ORDER BY superlikes DESC LIMIT ?'
);

const stmtGetById     = db.prepare('SELECT * FROM images WHERE ic_id = ?');
const stmtGetByType   = db.prepare('SELECT * FROM images WHERE type = ? ORDER BY RANDOM() LIMIT ?');

// ── Public API ─────────────────────────────────────────────────────────────────

export function getBySourceUrl(sourceUrl) {
  return stmtGetBySourceUrl.get(sourceUrl) ?? null;
}

export function insertImage(data) {
  stmtInsert.run(data);
}

export function incrementLikes(icId) {
  return stmtIncrementLikes.run(icId).changes > 0;
}

export function incrementSuperlikes(icId) {
  return stmtIncrementSuperlikes.run(icId).changes > 0;
}

export function getTopSuperlikes(limit = 50) {
  return stmtTopSuperlikes.all(limit);
}

export function getById(icId) {
  return stmtGetById.get(icId) ?? null;
}

export function getByType(type, limit = 120) {
  return stmtGetByType.all(type, limit);
}

export default db;
