import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

// ===================================================================
// 1. الإعدادات والتهيئة الآمنة (Safe Initialization)
// ===================================================================

// بيانات الدخول القديمة (للطوارئ - Backdoor)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

// تهيئة Supabase بشكل آمن (لن يكسر الموقع إذا كانت المفاتيح مفقودة)
let supabaseAdmin = null;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
        supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
        console.log("✅ Supabase initialized successfully");
    } catch (e) {
        console.error("⚠️ Failed to initialize Supabase:", e.message);
    }
} else {
    console.warn("⚠️ Supabase keys missing in .env - Running in Legacy Mode (Basic Auth only)");
}

// ===================================================================
// 2. الموجه الرئيسي (Main Handler)
// ===================================================================
export default async function handler(req, res) {
    // إعدادات CORS (ضرورية جداً لتجنب Failed to fetch من المتصفح)
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // 1. التحقق من الهوية (Authentication)
        const authResult = await authenticate(req);
        if (!authResult.isAuthenticated) {
            return res.status(401).json({ error: 'Unauthorized: يرجى تسجيل الدخول' });
        }

        const currentUser = authResult.user; // { role, email, type, id }

        // 2. توجيه الطلبات
        const url = req.url || '';

        // --- أ. مسارات إدارة الموظفين (Supabase User Management) ---
        // (تعمل فقط إذا كان Supabase مفعلاً والمستخدم Admin)
        if (supabaseAdmin && currentUser.role === 'admin') {
            if (req.method === 'POST' && url.includes('/add-user')) return await handleAddUser(req, res);
            if (req.method === 'GET' && url.includes('/users')) return await handleListUsers(req, res);
            if (req.method === 'DELETE' && url.includes('/delete-user')) return await handleDeleteUser(req, res);
        }

        // --- ب. مسارات البيانات (Google Sheets Operations) ---
        if (req.method === 'GET') {
            return await handleGet(req, res, currentUser);
        } else if (req.method === 'POST') {
            // التعامل مع تسجيل الدخول القديم
            if (url.includes('/login') || (req.body && req.body.username)) return handleLogin(req, res);
            if (url.includes('/logout')) return handleLogout(req, res);
            return await handlePost(req, res, currentUser);
        } else if (req.method === 'PUT') {
            return await handlePut(req, res, currentUser);
        } else if (req.method === 'DELETE') {
            // الحماية: الحذف للمدير فقط
            if (currentUser.role !== 'admin') {
                return res.status(403).json({ error: 'عفواً، الحذف مسموح للمدير فقط.' });
            }
            return await handleDelete(req, res);
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('CRITICAL SERVER ERROR:', error);
        // إرجاع رسالة خطأ واضحة بدلاً من انهيار الاتصال
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

// ===================================================================
// 3. منطق التحقق الهجين (Hybrid Auth Logic)
// ===================================================================
async function authenticate(req) {
    const authHeader = req.headers.authorization;
    const cookieHeader = req.headers.cookie || '';

    // 1. التحقق عبر الكوكيز (للجلسات القديمة)
    if (cookieHeader.includes('admin_session=1')) {
        return { isAuthenticated: true, user: { role: 'admin', email: 'Master Admin', type: 'master' } };
    }

    if (!authHeader) return { isAuthenticated: false };

    const [scheme, token] = authHeader.split(' ');

    // 2. التحقق عبر Basic Auth (المفتاح الماستر)
    if (scheme === 'Basic') {
        let decoded;
        try {
             decoded = (typeof atob === 'function') ? atob(token) : Buffer.from(token, 'base64').toString('utf8');
        } catch (e) { return { isAuthenticated: false }; }
        
        const [u, p] = decoded.split(':');
        if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
            return { isAuthenticated: true, user: { role: 'admin', email: 'Master Admin', type: 'master' } };
        }
    }

    // 3. التحقق عبر Supabase Token (إذا كان Supabase مفعلاً)
    if (scheme === 'Bearer' && supabaseAdmin) {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        
        if (error || !user) return { isAuthenticated: false };

        const role = user.user_metadata?.role || 'staff';
        return { 
            isAuthenticated: true, 
            user: { role, email: user.email, id: user.id, type: 'supabase' } 
        };
    }

    return { isAuthenticated: false };
}

// ===================================================================
// 4. العمليات الأساسية (Google Sheets CRUD)
// ===================================================================

async function getGoogleSheet() {
    try {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

        if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
            throw new Error("Google Sheets credentials missing in .env");
        }

        const serviceAccountAuth = new JWT({
            email: serviceAccountEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
        await doc.loadInfo();
        let sheet = doc.sheetsByTitle["Leads"];
        if (!sheet) sheet = doc.sheetsByIndex[0];
        return sheet;
    } catch (e) {
        console.error("Google Sheet Connection Error:", e);
        throw e;
    }
}

async function handleGet(req, res, currentUser) {
    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();

    const { searchTerm, statusFilter, paymentFilter, courseFilter, dateFilter, startDate, endDate } = req.query;

    const data = rows.map(row => ({
        timestamp: row.get('Timestamp') || '',
        inquiryId: row.get('Inquiry ID') || '',
        customerName: row.get('Full Name') || '',
        customerEmail: row.get('Email') || '',
        customerPhone: row.get('Phone Number') || '',
        course: row.get('Selected Course') || '',
        qualification: row.get('Qualification') || '',
        experience: row.get('Experience') || '',
        status: row.get('Payment Status') || 'pending',
        transactionId: row.get('Transaction ID') || '',
        paymentMethod: row.get('Payment Method') || '',
        cashplusCode: row.get('CashPlus Code') || '',
        last4: row.get('Last4Digits') || '',
        finalAmount: row.get('Amount') || 0,
        currency: row.get('Currency') || 'MAD',
        language: row.get('Lang') || 'ar',
        utm_source: row.get('utm_source') || '',
        utm_medium: row.get('utm_medium') || '',
        utm_campaign: row.get('utm_campaign') || '',
        utm_content: row.get('utm_content') || '',
        lastUpdatedBy: row.get('Last Updated By') || '', 
        parsedDate: parseDate(row.get('Timestamp') || ''),
        normalizedCourse: normalizeCourseName(row.get('Selected Course') || '')
    }));

    const overallStats = calculateStatistics(data);
    
    // فلترة البيانات
    let filteredData = data;
    const isFiltered = !!(searchTerm || statusFilter || paymentFilter || (dateFilter && dateFilter !== 'all') || courseFilter);

    if (isFiltered) {
        filteredData = data.filter(item => {
            const search = searchTerm ? searchTerm.toLowerCase() : '';
            const matchesSearch = !search || Object.values(item).some(val => String(val).toLowerCase().includes(search));
            const matchesStatus = !statusFilter || item.status === statusFilter;
            const matchesPayment = !paymentFilter || item.paymentMethod === paymentFilter;
            const matchesCourse = !courseFilter || courseFilter === '' || (item.normalizedCourse && item.normalizedCourse === courseFilter);
            const matchesDate = checkDateFilter(item, dateFilter, startDate, endDate);
            return matchesSearch && matchesStatus && matchesPayment && matchesCourse && matchesDate;
        });
    }

    const filteredStats = isFiltered ? calculateStatistics(filteredData) : overallStats;

    res.status(200).json({
        success: true,
        statistics: { overall: overallStats, filtered: filteredStats },
        data: filteredData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0)),
        currentUser: { role: currentUser.role, email: currentUser.email }
    });
}

async function handlePost(req, res, user) {
    const sheet = await getGoogleSheet();
    const newItem = req.body;
    
    await sheet.addRow({
        'Timestamp': new Date().toISOString(),
        'Inquiry ID': newItem.inquiryId,
        'Full Name': newItem.customerName,
        'Email': newItem.customerEmail,
        'Phone Number': newItem.customerPhone,
        'Selected Course': newItem.course,
        'Qualification': newItem.qualification || 'Not Specified',
        'Experience': newItem.experience || 'Not Specified',
        'Payment Status': newItem.status,
        'Payment Method': newItem.paymentMethod,
        'Transaction ID': newItem.transactionId || '', 
        'Currency': 'MAD',
        'Amount': newItem.finalAmount,
        'Lang': newItem.language,
        'utm_source': newItem.utm_source || 'manual_entry',
        'utm_medium': newItem.utm_medium || '',
        'utm_campaign': newItem.utm_campaign || '',
        'utm_term': newItem.utm_term || '',
        'utm_content': newItem.utm_content || '',
        'CashPlus Code': newItem.cashplusCode || '',
        'Last4Digits': newItem.last4 || '',
        'Last Updated By': user ? user.email : 'System'
    });

    res.status(201).json({ success: true, message: 'Record created' });
}

async function handlePut(req, res, user) {
    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();
    const updatedItem = req.body;
    const id = updatedItem.originalInquiryId;

    const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);
    if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });

    const row = rows[rowIndex];

    // تحديث الحقول
    if(updatedItem.customerName) row.set('Full Name', updatedItem.customerName);
    if(updatedItem.customerPhone) row.set('Phone Number', updatedItem.customerPhone);
    if(updatedItem.customerEmail) row.set('Email', updatedItem.customerEmail);
    if(updatedItem.course) row.set('Selected Course', updatedItem.course);
    if(updatedItem.qualification) row.set('Qualification', updatedItem.qualification);
    if(updatedItem.experience) row.set('Experience', updatedItem.experience);
    if(updatedItem.status) row.set('Payment Status', updatedItem.status);
    if(updatedItem.paymentMethod) row.set('Payment Method', updatedItem.paymentMethod);
    if(updatedItem.finalAmount) row.set('Amount', updatedItem.finalAmount);
    if(updatedItem.transactionId) row.set('Transaction ID', updatedItem.transactionId);
    if(updatedItem.language) row.set('Lang', updatedItem.language);
    if(updatedItem.utm_source) row.set('utm_source', updatedItem.utm_source);
    if(updatedItem.utm_medium) row.set('utm_medium', updatedItem.utm_medium);
    if(updatedItem.utm_campaign) row.set('utm_campaign', updatedItem.utm_campaign);
    if(updatedItem.utm_content) row.set('utm_content', updatedItem.utm_content);
    
    row.set('Last Updated By', user ? user.email : 'System');

    await row.save();
    res.status(200).json({ success: true, message: 'Updated successfully' });
}

async function handleDelete(req, res) {
    const { id } = req.body;
    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();
    const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);

    if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });
    
    await rows[rowIndex].delete();
    res.status(200).json({ success: true, message: 'Deleted successfully' });
}

// ===================================================================
// 5. دوال إدارة الموظفين (Supabase)
// ===================================================================

async function handleAddUser(req, res) {
    if (!supabaseAdmin) return res.status(503).json({ error: 'خدمة إدارة المستخدمين غير مفعلة (Missing Config)' });
    const { email, password, role } = req.body;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { role: role || 'staff' }
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ success: true, user: data.user });
}

async function handleListUsers(req, res) {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return res.status(400).json({ error: error.message });
    
    const cleanUsers = users.map(u => ({
        id: u.id, email: u.email, role: u.user_metadata?.role || 'staff',
        last_sign_in: u.last_sign_in_at, created_at: u.created_at
    }));
    return res.status(200).json({ users: cleanUsers });
}

async function handleDeleteUser(req, res) {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
    const { userId } = req.body;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ success: true });
}

// ===================================================================
// 6. دوال مساعدة (Login & Normalization)
// ===================================================================

async function handleLogin(req, res) {
    const { username, password } = req.body || {};
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const cookie = `admin_session=1; HttpOnly; Path=/; Max-Age=${24*60*60}; SameSite=None; Secure`;
        res.setHeader('Set-Cookie', cookie);
        return res.status(200).json({ success: true, message: 'Logged in' });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
}

async function handleLogout(req, res) {
    const cookie = `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure`;
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ success: true });
}

function parseDate(ts) {
    if (!ts) return null;
    let date;
    const isoTest = new Date(ts);
    if (!isNaN(isoTest.getTime())) date = isoTest;
    else {
        let cleaned = ts.replace(" h ", ":").replace(" min ", ":").replace(" s", "");
        date = new Date(cleaned);
    }
    return !isNaN(date.getTime()) ? date : null;
}

function checkDateFilter(item, filterValue, customStart, customEnd) {
    if (!filterValue || filterValue === 'all') return true;
    const itemDate = item.parsedDate;
    if (!itemDate) return false;
    
    const now = new Date();
    let startDate;
    switch (filterValue) {
        case 'hour': startDate = new Date(now.getTime() - (3600000)); return itemDate >= startDate;
        case 'day': startDate = new Date(now.getTime() - (86400000)); return itemDate >= startDate;
        case 'week': startDate = new Date(now.getTime() - (7 * 86400000)); return itemDate >= startDate;
        case 'month': startDate = new Date(now.getTime() - (30 * 86400000)); return itemDate >= startDate;
        case '3month': startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); return itemDate >= startDate;
        case 'year': startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); return itemDate >= startDate;
        case 'custom':
            if (customStart && customEnd) {
                const start = new Date(customStart + 'T00:00:00'); 
                const end = new Date(customEnd + 'T23:59:59');
                return itemDate >= start && itemDate <= end;
            }
            return true;
        default: return true;
    }
}

function calculateStatistics(dataArray) {
    const stats = {
        totalPayments: dataArray.length, paidPayments: 0, pendingPayments: 0, failedPayments: 0, canceledPayments: 0,
        cashplusPayments: 0, cardPayments: 0,
        netRevenue: 0, pendingRevenue: 0, failedRevenue: 0, canceledRevenue: 0,
        paid_cashplus: 0, paid_card: 0, net_cashplus_revenue: 0, net_card_revenue: 0,
        // تمت إضافة الحقول التي كانت مفقودة لضمان عمل الواجهة
        paid_cash: 0, paid_bank: 0, net_cash_revenue: 0, net_bank_revenue: 0,
        pending_cashplus: 0, failed_cashplus: 0, canceled_cashplus: 0
    };

    if (!dataArray || dataArray.length === 0) return stats;

    for (const item of dataArray) {
        const amount = parseFloat(item.finalAmount) || 0;
        const pm = (item.paymentMethod || '').toLowerCase();
        const isCashplus = pm === 'cashplus';
        const isCard = pm === 'card' || pm === 'credit_card';
        const isCash = pm === 'cash';
        const isBank = pm.includes('bank') || pm === 'virement';

        if (isCashplus) stats.cashplusPayments++;
        if (isCard) stats.cardPayments++;

        switch (item.status) {
            case 'paid':
                stats.paidPayments++; stats.netRevenue += amount;
                if (isCashplus) { stats.paid_cashplus++; stats.net_cashplus_revenue += amount; }
                if (isCard) { stats.paid_card++; stats.net_card_revenue += amount; }
                if (isCash) { stats.paid_cash++; stats.net_cash_revenue += amount; }
                if (isBank) { stats.paid_bank++; stats.net_bank_revenue += amount; }
                break;
            case 'pending':
                stats.pendingPayments++; stats.pendingRevenue += amount;
                if (isCashplus) stats.pending_cashplus++;
                break;
            case 'failed':
                stats.failedPayments++; stats.failedRevenue += amount;
                if (isCashplus) stats.failed_cashplus++;
                break;
            case 'canceled':
                stats.canceledPayments++; stats.canceledRevenue += amount;
                if (isCashplus) stats.canceled_cashplus++;
                break;
        }
    }
    return stats;
}

function normalizeCourseName(raw) {
    if (!raw) return 'دورات أخرى';
    const trimmed = String(raw).trim().toLowerCase();
    if (trimmed.includes('pmp')) return 'PMP';
    if (trimmed.includes('planning')) return 'Planning';
    if (trimmed.includes('qse')) return 'QSE';
    if (trimmed.includes('soft')) return 'Soft Skills';
    return 'دورات أخرى';
}
