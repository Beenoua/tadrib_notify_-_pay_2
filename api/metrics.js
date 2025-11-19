import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

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
            cacheSet(cacheKey, result);
            return res.status(200).json(result);
        }

        // timeseries endpoint: /api/metrics/timeseries?metric=daily_revenue
        if (pathname.endsWith('/timeseries')) {
            const { metric, start, end, granularity } = qp;
            const list = applyFilters(items).filter(i => i.status === 'paid');
            // default daily
            const byDay = {};
            for (const it of list) {
                const d = it.parsedDate ? it.parsedDate.toISOString().slice(0,10) : 'unknown';
                byDay[d] = (byDay[d] || 0) + it.amount;
            }
            const labels = Object.keys(byDay).sort();
            const series = labels.map(l => byDay[l]);
            return res.status(200).json({ success: true, metric: metric || 'daily_revenue', labels, series });
        }

        return res.status(400).json({ error: 'Unknown metrics route' });
    } catch (err) {
        console.error('Metrics error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
