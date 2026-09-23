import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    this.directory = directory;
    // A separate SQLite transaction owns the execution state, without blocking
    // ordinary WAL writes. OS locks are released when the owning process exits.
    this.owner = new DatabaseSync(path.join(directory, 'owner.db'));
    try {
      this.owner.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
      this.db = new DatabaseSync(path.join(directory, 'workspace.db'));
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL);');
    } catch (error) {
      this.db?.close(); this.owner.close();
      if (error.errcode === 5 || error.errcode === 6) throw new Error('project_locked');
      throw error;
    }
  }
  get(key) { const row = this.db.prepare('SELECT value FROM records WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); return value; }
  list(prefix) { return this.db.prepare('SELECT value FROM records WHERE key LIKE ? ORDER BY rowid DESC').all(prefix + '%').map(row => JSON.parse(row.value)); }
  event(kind, value) { this.db.prepare('INSERT INTO events (at,kind,value) VALUES (?,?,?)').run(new Date().toISOString(), kind, JSON.stringify(value)); }
  events(after = 0) { return this.db.prepare('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT 100').all(after).map(row => ({...row, value: JSON.parse(row.value)})); }
  close() { if (this.db.isOpen) this.db.close(); if (this.owner.isOpen) this.owner.close(); }
}
