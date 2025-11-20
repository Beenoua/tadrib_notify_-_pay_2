import fs from 'fs';
import path from 'path';

// Try to dynamically import better-sqlite3. If it's not available (failed optional install),
// fall back to an in-memory event store so the API remains functional (non-persistent).
let Database = null;
let hasSqlite = false;
try {
    const mod = await import('better-sqlite3').catch(() => null);
    if (mod && mod.default) {
        Database = mod.default;
        hasSqlite = true;
    }
} catch (e) {
    hasSqlite = false;
}

// Simple events ingestion endpoint backed by SQLite
const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'events.sqlite');

// In-memory fallback store (used when better-sqlite3 is unavailable)
const inMemoryEvents = [];
let inMemoryId = 1;

function ensureDb() {
    if (!hasSqlite) return null;
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const db = new Database(DB_FILE);
    try { db.pragma('journal_mode = WAL'); } catch (e) {}
    db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT,
            inquiry_id TEXT,
            session_id TEXT,
            course TEXT,
            timestamp TEXT,
            metadata TEXT,
            utm_source TEXT,
            utm_medium TEXT,
            utm_campaign TEXT,
            created_at TEXT
        );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_events_inquiry ON events(inquiry_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);');
    return db;
}

function sendJSON(res, code, obj) {
    res.setHeader('Content-Type', 'application/json');
    res.status(code).end(JSON.stringify(obj));
}

export default async function handler(req, res) {
    // CORS
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-events-token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    // Auth for write: accept admin_session cookie OR header token
    const writeToken = process.env.EVENTS_WRITE_TOKEN || '';
    const cookieHeader = req.headers.cookie || '';
    const authHeader = req.headers.authorization || '';
    const tokenHeader = req.headers['x-events-token'] || '';
    const allowWrite = (cookieHeader.includes('admin_session=1')) || (tokenHeader && tokenHeader === writeToken);

    try {
        const db = ensureDb();

        if (req.method === 'POST') {
            if (!allowWrite) return sendJSON(res, 401, { error: 'Unauthorized' });
            const body = req.body || {};
            const eventType = body.eventType || body.type || 'unknown';
            const inquiryId = body.inquiryId || null;
            const sessionId = body.sessionId || null;
            const course = body.course || null;
            const timestamp = body.timestamp || new Date().toISOString();
            const metadata = body.metadata ? JSON.stringify(body.metadata) : (body.metadataString || null);
            const utm_source = body.utm_source || null;
            const utm_medium = body.utm_medium || null;
            const utm_campaign = body.utm_campaign || null;

            if (db) {
                const stmt = db.prepare(`INSERT INTO events (event_type, inquiry_id, session_id, course, timestamp, metadata, utm_source, utm_medium, utm_campaign, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
                const info = stmt.run(eventType, inquiryId, sessionId, course, timestamp, metadata, utm_source, utm_medium, utm_campaign, new Date().toISOString());
                return sendJSON(res, 201, { success: true, id: info.lastInsertRowid, persistence: 'sqlite' });
            }

            // Fallback: store in-memory (non-persistent)
            const rec = {
                id: inMemoryId++,
                event_type: eventType,
                inquiry_id: inquiryId,
                session_id: sessionId,
                course,
                timestamp,
                metadata,
                utm_source,
                utm_medium,
                utm_campaign,
                created_at: new Date().toISOString()
            };
            inMemoryEvents.push(rec);
            return sendJSON(res, 201, { success: true, id: rec.id, persistence: 'memory' });
        }

        if (req.method === 'GET') {
            // simple query interface (admin-only)
            if (!allowWrite && !cookieHeader.includes('admin_session=1')) return sendJSON(res, 401, { error: 'Unauthorized' });
            const { start, end, eventType, inquiryId, limit } = req.query;
            let q = 'SELECT * FROM events WHERE 1=1';
            const params = [];
            if (eventType) { q += ' AND event_type = ?'; params.push(eventType); }
            if (inquiryId) { q += ' AND inquiry_id = ?'; params.push(inquiryId); }
            if (start) { q += ' AND timestamp >= ?'; params.push(start + 'T00:00:00'); }
            if (end) { q += ' AND timestamp <= ?'; params.push(end + 'T23:59:59'); }
            q += ' ORDER BY timestamp DESC';
            if (limit) q += ' LIMIT ' + (Number(limit) || 100);

            if (db) {
                const rows = db.prepare(q).all(...params);
                return sendJSON(res, 200, { success: true, rows, persistence: 'sqlite' });
            }

            // Fallback: filter in-memory events
            let rows = inMemoryEvents.slice().reverse();
            if (eventType) rows = rows.filter(r => r.event_type === eventType);
            if (inquiryId) rows = rows.filter(r => r.inquiry_id === inquiryId);
            if (start) rows = rows.filter(r => r.timestamp >= start + 'T00:00:00');
            if (end) rows = rows.filter(r => r.timestamp <= end + 'T23:59:59');
            if (limit) rows = rows.slice(0, Number(limit) || 100);
            return sendJSON(res, 200, { success: true, rows, persistence: 'memory' });
        }

        return sendJSON(res, 405, { error: 'Method Not Allowed' });
    } catch (err) {
        console.error('Events error', err);
        return sendJSON(res, 500, { error: 'Internal server error' });
    }
}
