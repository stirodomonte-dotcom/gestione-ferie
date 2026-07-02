'use strict';
const crypto = require('crypto');

let db;

if (process.env.TURSO_URL) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });

  const queue = [];
  let ready = false;

  async function initTurso() {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS dipendenti (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cognome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        ruolo TEXT NOT NULL DEFAULT 'dipendente', reparto TEXT,
        giorni_ferie INTEGER NOT NULL DEFAULT 26, giorni_permesso INTEGER NOT NULL DEFAULT 8,
        attivo INTEGER NOT NULL DEFAULT 1, data_assunzione TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS richieste (
        id INTEGER PRIMARY KEY AUTOINCREMENT, dipendente_id INTEGER NOT NULL, tipo TEXT NOT NULL,
        data_inizio TEXT NOT NULL, data_fine TEXT NOT NULL, giorni REAL NOT NULL,
        ore_permesso REAL, stato TEXT NOT NULL DEFAULT 'in_attesa',
        note_dipendente TEXT, note_admin TEXT, approvato_da INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS festivita (
        id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL UNIQUE, nome TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessioni (
        sid TEXT PRIMARY KEY, data TEXT NOT NULL, scadenza INTEGER NOT NULL
      );
    `);

    const r = await client.execute("SELECT id FROM dipendenti WHERE ruolo='admin' LIMIT 1");
    if (r.rows.length === 0) {
      await client.execute({ sql: `INSERT INTO dipendenti (nome,cognome,email,username,password_hash,ruolo,reparto) VALUES (?,?,?,?,?,'admin','Amministrazione')`,
        args: ['Amministratore','Sistema','admin@azienda.it','admin', hashPassword('Admin2024!')] });
      console.log('✓ Admin creato → username: admin | password: Admin2024!');
    }

    const anno = new Date().getFullYear();
    for (const y of [anno, anno+1]) {
      for (const [d,n] of [
        [`${y}-01-01`,'Capodanno'],[`${y}-01-06`,'Epifania'],
        [`${y}-04-25`,'Festa della Liberazione'],[`${y}-05-01`,'Festa dei Lavoratori'],
        [`${y}-06-02`,'Festa della Repubblica'],[`${y}-08-15`,'Ferragosto'],
        [`${y}-11-01`,'Tutti i Santi'],[`${y}-12-08`,'Immacolata Concezione'],
        [`${y}-12-25`,'Natale'],[`${y}-12-26`,'Santo Stefano'],
      ]) await client.execute({ sql: "INSERT OR IGNORE INTO festivita(data,nome) VALUES(?,?)", args:[d,n] });
    }

    ready = true;
    console.log('✓ Database Turso pronto');
    queue.forEach(fn => fn());
  }

  initTurso().catch(err => { console.error('Errore Turso:', err); process.exit(1); });

  db = {
    _turso: true, client,
    isReady: () => ready,
    onReady: (fn) => ready ? fn() : queue.push(fn),
    async all(sql, ...args) {
      const r = await client.execute({ sql, args: args.flat() });
      return r.rows.map(row => Object.fromEntries(Object.entries(row)));
    },
    async get(sql, ...args) { const rows = await db.all(sql, ...args); return rows[0]||null; },
    async run(sql, ...args) {
      const r = await client.execute({ sql, args: args.flat() });
      return { lastInsertRowid: r.lastInsertRowid, changes: r.rowsAffected };
    },
    prepare(sql) { return { all:(...a)=>db.all(sql,...a), get:(...a)=>db.get(sql,...a), run:(...a)=>db.run(sql,...a) }; }
  };

} else {
  const { DatabaseSync } = require('node:sqlite');
  const path = require('path'), fs = require('fs');
  const DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new DatabaseSync(path.join(DATA_DIR, 'ferie.db'));
  sqlite.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS dipendenti (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cognome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, ruolo TEXT NOT NULL DEFAULT 'dipendente', reparto TEXT, giorni_ferie INTEGER NOT NULL DEFAULT 26, giorni_permesso INTEGER NOT NULL DEFAULT 8, attivo INTEGER NOT NULL DEFAULT 1, data_assunzione TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS richieste (id INTEGER PRIMARY KEY AUTOINCREMENT, dipendente_id INTEGER NOT NULL, tipo TEXT NOT NULL, data_inizio TEXT NOT NULL, data_fine TEXT NOT NULL, giorni REAL NOT NULL, ore_permesso REAL, stato TEXT NOT NULL DEFAULT 'in_attesa', note_dipendente TEXT, note_admin TEXT, approvato_da INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS festivita (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL UNIQUE, nome TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessioni (sid TEXT PRIMARY KEY, data TEXT NOT NULL, scadenza INTEGER NOT NULL);
  `);
  if (!sqlite.prepare("SELECT id FROM dipendenti WHERE ruolo='admin' LIMIT 1").get()) {
    sqlite.prepare(`INSERT INTO dipendenti (nome,cognome,email,username,password_hash,ruolo,reparto) VALUES (?,?,?,?,?,'admin','Amministrazione')`)
      .run('Amministratore','Sistema','admin@azienda.it','admin',hashPassword('Admin2024!'));
    console.log('✓ Admin creato → username: admin | password: Admin2024!');
  }
  const anno = new Date().getFullYear();
  [anno,anno+1].forEach(y=>{
    [[`${y}-01-01`,'Capodanno'],[`${y}-01-06`,'Epifania'],[`${y}-04-25`,'Festa della Liberazione'],[`${y}-05-01`,'Festa dei Lavoratori'],[`${y}-06-02`,'Festa della Repubblica'],[`${y}-08-15`,'Ferragosto'],[`${y}-11-01`,'Tutti i Santi'],[`${y}-12-08`,'Immacolata Concezione'],[`${y}-12-25`,'Natale'],[`${y}-12-26`,'Santo Stefano']]
    .forEach(([d,n])=>sqlite.prepare("INSERT OR IGNORE INTO festivita(data,nome) VALUES(?,?)").run(d,n));
  });
  db = {
    _turso: false, isReady:()=>true, onReady:(fn)=>fn(),
    async all(sql,...args) { return sqlite.prepare(sql).all(...args.flat()); },
    async get(sql,...args) { return sqlite.prepare(sql).get(...args.flat())||null; },
    async run(sql,...args) { return sqlite.prepare(sql).run(...args.flat()); },
    prepare(sql) { return { all:(...a)=>sqlite.prepare(sql).all(...a.flat()), get:(...a)=>sqlite.prepare(sql).get(...a.flat())||null, run:(...a)=>sqlite.prepare(sql).run(...a.flat()) }; }
  };
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(plain,salt,64).toString('hex')}`;
}
function verifyPassword(plain, stored) {
  try { const [s,h]=stored.split(':'); return crypto.scryptSync(plain,s,64).toString('hex')===h; } catch{return false;}
}

const sessions = {
  async get(sid) {
    await db.run("DELETE FROM sessioni WHERE scadenza < ?", Date.now());
    const row = await db.get("SELECT data FROM sessioni WHERE sid=?", sid);
    return row ? JSON.parse(row.data) : null;
  },
  async set(sid, data, maxAgeMs=8*3600*1000) {
    await db.run("INSERT OR REPLACE INTO sessioni(sid,data,scadenza) VALUES(?,?,?)", sid, JSON.stringify(data), Date.now()+maxAgeMs);
  },
  async destroy(sid) { await db.run("DELETE FROM sessioni WHERE sid=?", sid); }
};

module.exports = { db, hashPassword, verifyPassword, sessions };
