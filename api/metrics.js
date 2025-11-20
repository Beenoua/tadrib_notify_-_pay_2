import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

// Simple auth (same behavior as api/admin.js)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

function parseDate(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

// lightweight normalization
function normalizeCourseName(raw) {
    if (!raw) return 'Other';
    const t = String(raw).trim();
    const lower = t.toLowerCase();
    if (lower.includes('pmp')) return 'PMP';
    if (lower.includes('planning')) return 'Planning';
    if (lower.includes('qse')) return 'QSE';
    if (lower.includes('soft')) return 'Soft Skills';
    return t || 'Other';
}

async function getGoogleSheet() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!spreadsheetId || !serviceAccountEmail || !privateKey) throw new Error('Missing Google Sheets credentials');
    const serviceAccountAuth = new JWT({ email: serviceAccountEmail, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle['Leads'];
    if (!sheet) sheet = doc.sheetsByIndex[0];
    if (!sheet) throw new Error('No sheet found');
    return sheet;
}

// simple in-memory cache
const CACHE = new Map();
const CACHE_TTL = 20 * 1000; // 20s

function cacheGet(key) {
    const e = CACHE.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL) { CACHE.delete(key); return null; }
    return e.value;
}
function cacheSet(key, value) { CACHE.set(key, { ts: Date.now(), value }); }

function authCheck(req, res) {
    const cookieHeader = req.headers.cookie || '';
    if (cookieHeader.includes('admin_session=1')) return true;
    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ error: 'Authentication required' }); return false; }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [u, p] = decoded.split(':');
        if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) return true;
    } catch (e) { /* ignore */ }
    res.status(401).json({ error: 'Invalid credentials' });
    return false;
}

// Events DB helpers (optional integration)
const EVENTS_DB_DIR = path.resolve(process.cwd(), 'data');
const EVENTS_DB_FILE = path.join(EVENTS_DB_DIR, 'events.sqlite');

// Postgres pool for events (preferred durable store)
const DATABASE_URL = process.env.DATABASE_URL || '';
let pgPool = null;
if (DATABASE_URL) {
    try { pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }); } catch (e) { console.warn('Could not create pg pool', e && e.message); pgPool = null; }
}

function openEventsDbIfExists() {
    try {
        if (!fs.existsSync(EVENTS_DB_FILE)) return null;
        const db = new Database(EVENTS_DB_FILE, { readonly: true });
        return db;
    } catch (err) {
        console.warn('Could not open events DB', err && err.message);
        return null;
    }
}

function computeFunnelSummary(db, start, end) {
    // If Postgres pool is available, compute funnel from Postgres
    if (pgPool) {
        try {
            const startTs = start ? start + 'T00:00:00' : '1970-01-01T00:00:00';
            const endTs = end ? end + 'T23:59:59' : new Date().toISOString();
            const inquiriesRes = pgPool.query(`SELECT COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= $1 AND timestamp <= $2`, [startTs, endTs]);
            const convertedRes = pgPool.query(`SELECT COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= $1 AND timestamp <= $2 AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success')`, [startTs, endTs]);
            const paymentsRes = pgPool.query(`SELECT COUNT(*) AS cnt FROM events WHERE lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= $1 AND timestamp <= $2`, [startTs, endTs]);
            return Promise.all([inquiriesRes, convertedRes, paymentsRes]).then(([inqR, convR, payR]) => {
                const inquiries = (inqR && inqR.rows && inqR.rows[0]) ? +inqR.rows[0].cnt : 0;
                const converted = (convR && convR.rows && convR.rows[0]) ? +convR.rows[0].cnt : 0;
                const payments = (payR && payR.rows && payR.rows[0]) ? +payR.rows[0].cnt : 0;
                const conversionRate = inquiries > 0 ? +(converted / inquiries).toFixed(4) : 0;
                return { inquiries, converted, payments, conversionRate };
            }).catch(err => { console.warn('Funnel compute pg error', err && err.message); return null; });
        } catch (err) { console.warn('Funnel compute pg error', err && err.message); return null; }
    }
    if (!db) return null;
    try {
        const startTs = start ? start + 'T00:00:00' : '1970-01-01T00:00:00';
        const endTs = end ? end + 'T23:59:59' : new Date().toISOString();

        const totalInquiriesRow = db.prepare(`SELECT COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= ? AND timestamp <= ?`).get(startTs, endTs);
        const inquiries = totalInquiriesRow ? (totalInquiriesRow.cnt || 0) : 0;

        const convertedRow = db.prepare(`SELECT COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= ? AND timestamp <= ? AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success')`).get(startTs, endTs);
        const converted = convertedRow ? (convertedRow.cnt || 0) : 0;

        const paymentsRow = db.prepare(`SELECT COUNT(*) AS cnt FROM events WHERE lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= ? AND timestamp <= ?`).get(startTs, endTs);
        const payments = paymentsRow ? (paymentsRow.cnt || 0) : 0;

        const conversionRate = inquiries > 0 ? +(converted / inquiries).toFixed(4) : 0;
        return { inquiries, converted, payments, conversionRate };
    } catch (err) {
        console.warn('Funnel compute error', err && err.message);
        return null;
    }
}

export default async function handler(req, res) {
    // CORS
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    if (!authCheck(req, res)) return;

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname || '';
    const qp = req.query || {};

    try {
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();

        // map rows to objects
        const items = rows.map(r => ({
            timestamp: r.get('Timestamp') || '',
            inquiryId: r.get('Inquiry ID') || '',
            course: r.get('Selected Course') || '',
            status: (r.get('Payment Status') || 'pending').toLowerCase(),
            paymentMethod: (r.get('Payment Method') || '').toLowerCase(),
            amount: parseFloat(r.get('Amount') || 0) || 0,
            language: (r.get('Lang') || 'ar').toLowerCase(),
            utm_source: r.get('utm_source') || '',
            utm_medium: r.get('utm_medium') || '',
            utm_campaign: r.get('utm_campaign') || '',
            last4: r.get('Last4Digits') || '',
            cashplusCode: r.get('CashPlus Code') || '',
            parsedDate: parseDate(r.get('Timestamp') || ''),
            normalizedCourse: normalizeCourseName(r.get('Selected Course') || '')
        }));

        // apply basic filters from query params
        function applyFilters(list) {
            const { start, end, course, paymentMethod, language, utm_campaign } = qp;
            return list.filter(item => {
                if (course && course !== '' && String(item.normalizedCourse) !== String(course)) return false;
                if (paymentMethod && paymentMethod !== '' && item.paymentMethod !== paymentMethod) return false;
                if (language && language !== '' && item.language !== language) return false;
                if (utm_campaign && utm_campaign !== '' && item.utm_campaign !== utm_campaign) return false;
                if (start) {
                    const s = new Date(start + 'T00:00:00');
                    if (!item.parsedDate || item.parsedDate < s) return false;
                }
                if (end) {
                    const e = new Date(end + 'T23:59:59');
                    if (!item.parsedDate || item.parsedDate > e) return false;
                }
                return true;
            });
        }

        if (pathname.endsWith('/summary') || pathname.endsWith('/')) {
            const cacheKey = 'summary:' + JSON.stringify(qp || {});
            const cached = cacheGet(cacheKey);
            if (cached) return res.status(200).json(cached);

            const filtered = applyFilters(items);
            const totalRevenue = filtered.filter(i => i.status === 'paid').reduce((s,i)=>s+i.amount,0);
            const paidRevenue = totalRevenue;
            const pendingRevenue = filtered.filter(i => i.status === 'pending').reduce((s,i)=>s+i.amount,0);
            const totalTransactions = filtered.length;
            const successfulTransactions = filtered.filter(i => i.status === 'paid').length;
            const failedTransactions = filtered.filter(i => i.status === 'failed').length;
            const aov = successfulTransactions > 0 ? +(totalRevenue / successfulTransactions).toFixed(2) : 0;

            // revenue per course
            const revPerCourse = {};
            const revPerPaymentMethod = {};
            const revPerLanguage = {};
            for (const it of filtered) {
                if (it.status === 'paid') {
                    const c = it.normalizedCourse || 'Other';
                    revPerCourse[c] = (revPerCourse[c] || 0) + it.amount;
                    const pm = it.paymentMethod || 'other';
                    revPerPaymentMethod[pm] = (revPerPaymentMethod[pm] || 0) + it.amount;
                    const lg = it.language || 'unknown';
                    revPerLanguage[lg] = (revPerLanguage[lg] || 0) + it.amount;
                }
            }

            const result = {
                success: true,
                summary: {
                    totalRevenue, paidRevenue, pendingRevenue, totalTransactions, successfulTransactions, failedTransactions, averageOrderValue: aov
                },
                revenuePerCourse: revPerCourse,
                revenuePerPaymentMethod: revPerPaymentMethod,
                revenuePerLanguage: revPerLanguage,
                count: filtered.length
            };

            // Try to augment summary with funnel KPIs from events DB (if present)
            try {
                const eventsDb = openEventsDbIfExists();
                    if (pgPool) {
                        const funnel = await computeFunnelSummary(null, qp.start, qp.end);
                        if (funnel) result.summary.funnel = funnel;
                    } else if (eventsDb) {
                        const funnel = computeFunnelSummary(eventsDb, qp.start, qp.end);
                        if (funnel) result.summary.funnel = funnel;
                        try { eventsDb.close(); } catch (e) { /* ignore */ }
                    }
            } catch (err) {
                console.warn('Could not compute funnel metrics', err && err.message);
            }
            cacheSet(cacheKey, result);
            return res.status(200).json(result);
        }

        // timeseries endpoint: /api/metrics/timeseries?metric=daily_revenue|daily_inquiries|daily_funnel
        if (pathname.endsWith('/timeseries')) {
            const { metric, start, end, granularity } = qp;

            // revenue timeseries from sheet rows (paid)
            if (!metric || metric === 'daily_revenue') {
                const list = applyFilters(items).filter(i => i.status === 'paid');
                const byDay = {};
                for (const it of list) {
                    const d = it.parsedDate ? it.parsedDate.toISOString().slice(0,10) : 'unknown';
                    byDay[d] = (byDay[d] || 0) + it.amount;
                }
                const labels = Object.keys(byDay).sort();
                const series = labels.map(l => byDay[l]);
                return res.status(200).json({ success: true, metric: metric || 'daily_revenue', labels, series });
            }

            // event-based timeseries (requires events DB)
            const startTs = start ? start + 'T00:00:00' : '1970-01-01T00:00:00';
            const endTs = end ? end + 'T23:59:59' : new Date().toISOString();

            // If Postgres is available use it
            if (pgPool) {
                if (!metric || metric === 'daily_revenue') {
                    // revenue still computed from Google Sheets above
                    const list = applyFilters(items).filter(i => i.status === 'paid');
                    const byDay = {};
                    for (const it of list) {
                        const d = it.parsedDate ? it.parsedDate.toISOString().slice(0,10) : 'unknown';
                        byDay[d] = (byDay[d] || 0) + it.amount;
                    }
                    const labels = Object.keys(byDay).sort();
                    const series = labels.map(l => byDay[l]);
                    return res.status(200).json({ success: true, metric: metric || 'daily_revenue', labels, series });
                }

                if (metric === 'daily_inquiries') {
                    const q = `SELECT to_char(timestamp::date,'YYYY-MM-DD') AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= $1 AND timestamp <= $2 GROUP BY day ORDER BY day ASC`;
                    const r = await pgPool.query(q, [startTs, endTs]);
                    const rows = r.rows || [];
                    const labels = rows.map(r => r.day);
                    const series = rows.map(r => +r.cnt);
                    return res.status(200).json({ success: true, metric, labels, series });
                }

                if (metric === 'daily_conversions') {
                    const q = `SELECT to_char(timestamp::date,'YYYY-MM-DD') AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= $1 AND timestamp <= $2 GROUP BY day ORDER BY day ASC`;
                    const r = await pgPool.query(q, [startTs, endTs]);
                    const rows = r.rows || [];
                    const labels = rows.map(r => r.day);
                    const series = rows.map(r => +r.cnt);
                    return res.status(200).json({ success: true, metric, labels, series });
                }

                if (metric === 'daily_funnel') {
                    const qInq = `SELECT to_char(timestamp::date,'YYYY-MM-DD') AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= $1 AND timestamp <= $2 GROUP BY day ORDER BY day ASC`;
                    const qConv = `SELECT to_char(timestamp::date,'YYYY-MM-DD') AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= $1 AND timestamp <= $2 GROUP BY day ORDER BY day ASC`;
                    const [inqR, convR] = await Promise.all([pgPool.query(qInq, [startTs, endTs]), pgPool.query(qConv, [startTs, endTs])]);
                    const inqRows = inqR.rows || [];
                    const convRows = convR.rows || [];
                    const mapInq = Object.fromEntries(inqRows.map(r => [r.day, +r.cnt]));
                    const mapConv = Object.fromEntries(convRows.map(r => [r.day, +r.cnt]));
                    const allDates = Array.from(new Set([...Object.keys(mapInq), ...Object.keys(mapConv)])).sort();
                    const inquiriesSeries = allDates.map(d => mapInq[d] || 0);
                    const conversionsSeries = allDates.map(d => mapConv[d] || 0);
                    return res.status(200).json({ success: true, metric, labels: allDates, series: { inquiries: inquiriesSeries, conversions: conversionsSeries } });
                }

                return res.status(400).json({ error: 'Unknown metric for timeseries' });
            }

            const eventsDb = openEventsDbIfExists();
            if (!eventsDb) return res.status(200).json({ success: true, metric, labels: [], series: [] });

            const startTsSql = start ? start + 'T00:00:00' : '1970-01-01T00:00:00';
            const endTsSql = end ? end + 'T23:59:59' : new Date().toISOString();

            if (metric === 'daily_inquiries') {
                const q = `SELECT substr(timestamp,1,10) AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= ? AND timestamp <= ? GROUP BY day ORDER BY day ASC`;
                const rows = eventsDb.prepare(q).all(startTsSql, endTsSql);
                const labels = rows.map(r => r.day);
                const series = rows.map(r => r.cnt);
                try { eventsDb.close(); } catch (e) {}
                return res.status(200).json({ success: true, metric, labels, series });
            }

            if (metric === 'daily_conversions') {
                const q = `SELECT substr(timestamp,1,10) AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= ? AND timestamp <= ? GROUP BY day ORDER BY day ASC`;
                const rows = eventsDb.prepare(q).all(startTsSql, endTsSql);
                const labels = rows.map(r => r.day);
                const series = rows.map(r => r.cnt);
                try { eventsDb.close(); } catch (e) {}
                return res.status(200).json({ success: true, metric, labels, series });
            }

            if (metric === 'daily_funnel') {
                const qInq = `SELECT substr(timestamp,1,10) AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND timestamp >= ? AND timestamp <= ? GROUP BY day ORDER BY day ASC`;
                const qConv = `SELECT substr(timestamp,1,10) AS day, COUNT(DISTINCT inquiry_id) AS cnt FROM events WHERE inquiry_id IS NOT NULL AND lower(event_type) IN ('payment','payment_success','paid','converted','completed','transaction_success') AND timestamp >= ? AND timestamp <= ? GROUP BY day ORDER BY day ASC`;
                const inqRows = eventsDb.prepare(qInq).all(startTsSql, endTsSql);
                const convRows = eventsDb.prepare(qConv).all(startTsSql, endTsSql);
                const mapInq = Object.fromEntries(inqRows.map(r => [r.day, r.cnt]));
                const mapConv = Object.fromEntries(convRows.map(r => [r.day, r.cnt]));
                const allDates = Array.from(new Set([...Object.keys(mapInq), ...Object.keys(mapConv)])).sort();
                const inquiriesSeries = allDates.map(d => mapInq[d] || 0);
                const conversionsSeries = allDates.map(d => mapConv[d] || 0);
                try { eventsDb.close(); } catch (e) {}
                return res.status(200).json({ success: true, metric, labels: allDates, series: { inquiries: inquiriesSeries, conversions: conversionsSeries } });
            }

            try { eventsDb.close(); } catch (e) {}
            return res.status(400).json({ error: 'Unknown metric for timeseries' });
        }

        return res.status(400).json({ error: 'Unknown metrics route' });
    } catch (err) {
        console.error('Metrics error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
