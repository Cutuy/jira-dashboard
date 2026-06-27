const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'store.db');
const JSON_PATH = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Init ──────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ── Schema ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    stage TEXT DEFAULT 'clarification',
    plan TEXT,
    worktree_path TEXT,
    branch_name TEXT,
    commit_sha TEXT,
    review_feedback TEXT,
    status TEXT DEFAULT 'idle',
    ocode_session TEXT,
    total_cpu TEXT,
    total_elapsed TEXT,
    token_cost REAL,
    token_input TEXT,
    token_output TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT,
    round INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    time TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_questions_ticket ON questions(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_activity_ticket ON activity(ticket_id);
`);

// ── Prepared statements ───────────────────────────────────
const stmts = {
  // Tickets
  getTicket: db.prepare(`SELECT * FROM tickets WHERE id = ?`),
  getAllTickets: db.prepare(`SELECT * FROM tickets ORDER BY updated_at DESC`),
  getAllTicketIds: db.prepare(`SELECT id FROM tickets`),
  insertTicket: db.prepare(`
    INSERT INTO tickets (id, title, content, stage, plan, worktree_path,
      branch_name, commit_sha, review_feedback, status, ocode_session,
      total_cpu, total_elapsed, token_cost, token_input, token_output,
      created_at, updated_at)
    VALUES (@id, @title, @content, @stage, @plan, @worktree_path,
      @branch_name, @commit_sha, @review_feedback, @status, @ocode_session,
      @total_cpu, @total_elapsed, @token_cost, @token_input, @token_output,
      @created_at, @updated_at)
  `),
  updateTicket: db.prepare(`
    UPDATE tickets SET
      title = @title, content = @content, stage = @stage, plan = @plan,
      worktree_path = @worktree_path, branch_name = @branch_name,
      commit_sha = @commit_sha, review_feedback = @review_feedback,
      status = @status, ocode_session = @ocode_session,
      total_cpu = @total_cpu, total_elapsed = @total_elapsed,
      token_cost = @token_cost, token_input = @token_input,
      token_output = @token_output, updated_at = @updated_at
    WHERE id = @id
  `),
  updateTicketField: (field) => db.prepare(`
    UPDATE tickets SET ${field} = ?, updated_at = ? WHERE id = ?
  `),
  deleteTicket: db.prepare(`DELETE FROM tickets WHERE id = ?`),

  // Questions
  insertQuestion: db.prepare(`
    INSERT INTO questions (ticket_id, question, answer, round)
    VALUES (?, ?, ?, ?)
  `),
  getQuestions: db.prepare(`
    SELECT * FROM questions WHERE ticket_id = ? ORDER BY id
  `),
  updateQuestionAnswer: db.prepare(`
    UPDATE questions SET answer = ? WHERE id = ? AND ticket_id = ?
  `),

  // Questions (bulk)
  deleteQuestions: db.prepare(`DELETE FROM questions WHERE ticket_id = ?`),

  // Activity
  insertActivity: db.prepare(`
    INSERT INTO activity (ticket_id, action, detail, time)
    VALUES (?, ?, ?, ?)
  `),
  getActivity: db.prepare(`
    SELECT * FROM activity WHERE ticket_id = ? ORDER BY time DESC LIMIT 500
  `),

  // Count
  nextQId: db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM questions`),
};

const updateFieldCache = {};
function getUpdateFieldStmt(field) {
  if (!updateFieldCache[field]) {
    updateFieldCache[field] = db.prepare(
      `UPDATE tickets SET ${field} = ?, updated_at = ? WHERE id = ?`
    );
  }
  return updateFieldCache[field];
}

// ── Public API ────────────────────────────────────────────

function getTicket(id) {
  const row = stmts.getTicket.get(id);
  if (!row) return null;
  row.questions = stmts.getQuestions.all(id);
  row.activity = stmts.getActivity.all(id);
  row.token_usage = (row.token_cost != null) ? {
    cost: String(row.token_cost),
    input: row.token_input || '',
    output: row.token_output || ''
  } : undefined;
  return row;
}

function getAllTickets() {
  const tickets = stmts.getAllTickets.all();
  for (const t of tickets) {
    t.questions = stmts.getQuestions.all(t.id);
    t.activity = stmts.getActivity.all(t.id);
    if (t.token_cost != null) {
      t.token_usage = {
        cost: String(t.token_cost),
        input: t.token_input || '',
        output: t.token_output || ''
      };
    }
  }
  return tickets;
}

function createTicket(data) {
  const defaults = {
    stage: 'clarification',
    status: 'idle',
    content: '',
    plan: null,
    worktree_path: null,
    branch_name: null,
    commit_sha: null,
    review_feedback: null,
    ocode_session: null,
    total_cpu: null,
    total_elapsed: null,
    token_cost: null,
    token_input: null,
    token_output: null,
  };
  const t = { ...defaults, ...data };
  stmts.insertTicket.run(t);
  logActivity(t.id, 'created', t.title);
  return getTicket(t.id);
}

function updateTicket(id, fields) {
  const ticket = stmts.getTicket.get(id);
  if (!ticket) return null;
  const merged = { ...ticket, ...fields, updated_at: new Date().toISOString() };
  stmts.updateTicket.run(merged);
  return getTicket(id);
}

function updateTicketField(id, field, value) {
  const now = new Date().toISOString();
  getUpdateFieldStmt(field).run(value, now, id);
}

function deleteTicket(id) {
  stmts.deleteTicket.run(id);
}

function deleteQuestionsForTicket(ticketId) {
  stmts.deleteQuestions.run(ticketId);
}

function addQuestion(ticketId, questionText, answer, round) {
  const info = stmts.insertQuestion.run(ticketId, questionText, answer || null, round || 1);
  return Number(info.lastInsertRowid);
}

function updateQuestionAnswer(questionId, ticketId, answer) {
  stmts.updateQuestionAnswer.run(answer, questionId, ticketId);
}

function logActivity(ticketId, action, detail) {
  stmts.insertActivity.run(ticketId, action, detail || '', new Date().toISOString());
}

function nextQuestionId() {
  return stmts.nextQId.get().n;
}

function getTicketIds() {
  return stmts.getAllTicketIds.all().map(r => r.id);
}

function close() {
  db.close();
}

// ── Migration from JSON ───────────────────────────────────
function migrateFromJSON() {
  if (!fs.existsSync(JSON_PATH)) return;

  const raw = fs.readFileSync(JSON_PATH, 'utf-8');
  let data;
  try { data = JSON.parse(raw); } catch { return; }

  if (!data.tickets || Object.keys(data.tickets).length === 0) return;

  const migrateAll = db.transaction(() => {
    for (const [tid, t] of Object.entries(data.tickets)) {
      stmts.insertTicket.run({
        id: tid,
        title: t.title || '',
        content: t.content || '',
        stage: t.stage || 'clarification',
        plan: t.plan || null,
        worktree_path: t.worktree_path || null,
        branch_name: t.branch_name || null,
        commit_sha: t.commit_sha || null,
        review_feedback: t.review_feedback || null,
        status: t.status || 'idle',
        ocode_session: t.ocode_session || null,
        total_cpu: t.total_cpu || null,
        total_elapsed: t.total_elapsed || null,
        token_cost: t.token_usage?.cost ? parseFloat(t.token_usage.cost) : null,
        token_input: t.token_usage?.input || null,
        token_output: t.token_usage?.output || null,
        created_at: t.created_at || new Date().toISOString(),
        updated_at: t.updated_at || new Date().toISOString(),
      });

      if (t.questions) {
        for (const q of t.questions) {
          stmts.insertQuestion.run(tid, q.question, q.answer || null, q.round || 1);
        }
      }

      if (t.activity) {
        for (const a of t.activity) {
          stmts.insertActivity.run(tid, a.action, a.detail || '', a.time || new Date().toISOString());
        }
      }
    }
  });

  try {
    migrateAll();
    // Rename JSON to mark as migrated
    fs.renameSync(JSON_PATH, JSON_PATH + '.migrated');
    console.log(`Migrated ${Object.keys(data.tickets).length} tickets from store.json → store.db`);
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  }
}

// Run migration if needed
try {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM tickets`).get();
  if (row.cnt === 0 && fs.existsSync(JSON_PATH)) {
    migrateFromJSON();
  }
} catch (err) {
  if (err.message.includes('no such table')) {
    // Tables don't exist yet — shouldn't happen since we create above
    console.error('Schema missing:', err.message);
  } else {
    throw err;
  }
}

module.exports = {
  getTicket,
  getAllTickets,
  createTicket,
  updateTicket,
  updateTicketField,
  deleteTicket,
  addQuestion,
  updateQuestionAnswer,
  deleteQuestionsForTicket,
  logActivity,
  nextQuestionId,
  getTicketIds,
  close,
};
