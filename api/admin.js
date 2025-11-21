import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js'; // (NEW) إضافة مكتبة Supabase

// ===================================================================
// 1. الإعدادات والتهيئة (Supabase & Constants)
// ===================================================================

// (NEW) إعداد عميل Supabase
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// بيانات الدخول القديمة (للطوارئ - Backdoor)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

// ===================================================================
// 2. دوال مساعدة أصلية (لم يتم تغييرها)
// ===================================================================

function parseDate(ts) {
    if (!ts) return null;
    let date;
    const isoTest = new Date(ts);
    if (!isNaN(isoTest.getTime())) {
        date = isoTest;
    } else {
        let cleaned = ts.replace(" h ", ":").replace(" min ", ":").replace(" s", "");
        date = new Date(cleaned);
    }
    if (!isNaN(date.getTime())) { return date; }
    return null;
}

function checkDateFilter(item, filterValue, customStart, customEnd) {
    if (!filterValue || filterValue === 'all') { return true; }
    const itemDate = item.parsedDate;
    if (!itemDate) { return false; }
    
    const now = new Date();
    let startDate;
    switch (filterValue) {
        case 'hour': startDate = new Date(now.getTime() - (60 * 60 * 1000)); return itemDate >= startDate;
        case 'day': startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)); return itemDate >= startDate;
        case 'week': startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); return itemDate >= startDate;
        case 'month': startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); return itemDate >= startDate;
        case '3month': startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); return itemDate >= startDate;
        case '6month': startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); return itemDate >= startDate;
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
        cashplusPayments: 0, cardPayments: 0, arabicUsers: 0, frenchUsers: 0, englishUsers: 0,
        netRevenue: 0, pendingRevenue: 0, failedRevenue: 0, canceledRevenue: 0,
        paid_cashplus: 0, paid_card: 0, pending_cashplus: 0, pending_card: 0,
        failed_cashplus: 0, failed_card: 0, canceled_cashplus: 0, canceled_card: 0,
        net_cashplus_revenue: 0, net_card_revenue: 0,
    };
    if (!dataArray || dataArray.length === 0) return stats;

    for (const item of dataArray) {
        const amount = parseFloat(item.finalAmount) || 0;
        const isCashplus = item.paymentMethod === 'cashplus';
        const isCard = item.paymentMethod === 'card';

        if (item.language === 'ar') stats.arabicUsers++;
        if (item.language === 'fr') stats.frenchUsers++;
        if (item.language === 'en') stats.englishUsers++;
        if (isCashplus) stats.cashplusPayments++;
        if (isCard) stats.cardPayments++;

        switch (item.status) {
            case 'paid':
                stats.paidPayments++; stats.netRevenue += amount;
                if (isCashplus) { stats.paid_cashplus++; stats.net_cashplus_revenue += amount; }
                if (isCard) { stats.paid_card++; stats.net_card_revenue += amount; }
                break;
            case 'pending':
                stats.pendingPayments++; stats.pendingRevenue += amount;
                if (isCashplus) stats.pending_cashplus++;
                if (isCard) stats.pending_card++;
                break;
            case 'failed':
                stats.failedPayments++; stats.failedRevenue += amount;
                if (isCashplus) stats.failed_cashplus++;
                if (isCard) stats.failed_card++;
                break;
            case 'canceled':
            case 'cancelled':
                stats.canceledPayments++; stats.canceledRevenue += amount;
                if (isCashplus) stats.canceled_cashplus++;
                if (isCard) stats.canceled_card++;
                break;
        }
    }
    return stats;
}

// ===================================================================
// 3. الموجه الرئيسي (Main Handler)
// ===================================================================
export default async function handler(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // (UPDATE) التحقق باستخدام النظام الهجين
    const authResult = await authenticate(req);
    if (!authResult.isAuthenticated) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }
    const currentUser = authResult.user; // المستخدم الحالي

    try {
        const url = req.url || '';

        // --- (NEW) مسارات إدارة الموظفين (Admin Only) ---
        if (currentUser.role === 'admin') {
            if (req.method === 'POST' && url.includes('/add-user')) {
                return await handleAddUser(req, res);
            }
            if (req.method === 'GET' && url.includes('/users')) {
                return await handleListUsers(req, res);
            }
            if (req.method === 'DELETE' && url.includes('/delete-user')) {
                return await handleDeleteUser(req, res);
            }
        }

        // --- مسارات البيانات (Google Sheets) ---
        if (req.method === 'GET') {
            return handleGet(req, res, currentUser);
        } else if (req.method === 'POST') {
            // التعامل مع طلبات تسجيل الدخول القديمة إن وجدت
            if (req.body && req.body.username && req.body.password) return handleLogin(req, res);
            if (url.includes('/login')) return handleLogin(req, res);
            if (url.includes('/logout')) return handleLogout(req, res);

            return handlePost(req, res, currentUser);
        } else if (req.method === 'PUT') {
            return handlePut(req, res, currentUser);
        } else if (req.method === 'DELETE') {
            // (UPDATE) الحذف مسموح للمدير فقط
            if (currentUser.role !== 'admin') {
                return res.status(403).json({ error: 'حذف البيانات مسموح للمدير فقط' });
            }
            return handleDelete(req, res);
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Handler Error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

// ===================================================================
// 4. دوال المصادقة (Updated Authentication)
// ===================================================================

async function handleLogin(req, res) {
    // دالة تسجيل الدخول القديمة (Session Cookie) - تم الاحتفاظ بها
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: 'username and password required' });

        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const maxAge = 24 * 60 * 60;
            const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            const sameSite = 'None';
            const cookie = `admin_session=1; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secureFlag}`;
            res.setHeader('Set-Cookie', cookie);
            return res.status(200).json({ success: true, message: 'Logged in' });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function authenticate(req) {
    const authHeader = req.headers.authorization;
    
    // 1. التحقق عبر الكوكيز (للجلسات القديمة)
    const cookieHeader = req.headers.cookie || '';
    if (cookieHeader.includes('admin_session=1')) {
        return { isAuthenticated: true, user: { role: 'admin', email: 'master_cookie', type: 'master' } };
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
            return { isAuthenticated: true, user: { role: 'admin', email: 'master_admin', type: 'master' } };
        }
    }

    // 3. (NEW) التحقق عبر Supabase Token
    if (scheme === 'Bearer') {
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

async function handleLogout(req, res) {
    try {
        const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        const sameSite = 'None';
        const cookie = `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secureFlag}`;
        res.setHeader('Set-Cookie', cookie);
        return res.status(200).json({ success: true, message: 'Logged out' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// ===================================================================
// 5. العمليات على البيانات (CRUD with Google Sheets)
// ===================================================================

async function getGoogleSheet() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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
}

async function handleGet(req, res, user) {
    // (نفس منطق الجلب والفلترة الأصلي، مع إضافة معلومات المستخدم للرد)
    const { searchTerm, statusFilter, paymentFilter, courseFilter, dateFilter, startDate, endDate } = req.query;

    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();

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
        utm_term: row.get('utm_term') || '',
        utm_content: row.get('utm_content') || '',
        parsedDate: parseDate(row.get('Timestamp') || ''),
        normalizedCourse: normalizeCourseName(row.get('Selected Course') || ''),
        // (NEW) قراءة حقل آخر تعديل
        lastUpdatedBy: row.get('Last Updated By') || ''
    }));
    
    const overallStats = calculateStatistics(data);
    const isFiltered = !!(searchTerm || statusFilter || paymentFilter || (dateFilter && dateFilter !== 'all'));

    let filteredData = data;
    let filteredStats = overallStats;

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
        filteredStats = calculateStatistics(filteredData);
    }

    res.status(200).json({
        success: true,
        statistics: { overall: overallStats, filtered: filteredStats },
        data: filteredData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0)),
        isFiltered: isFiltered,
        currentUser: { role: user.role, email: user.email } // إرسال معلومات المستخدم للواجهة
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
        // (NEW) تسجيل من قام بالإضافة
        'Last Updated By': user ? user.email : 'System'
    });

    res.status(201).json({ success: true, message: 'Record created successfully' });
}

async function handlePut(req, res, user) {
    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();
    const updatedItem = req.body;
    const id = updatedItem.originalInquiryId;

    if (!id) return res.status(400).json({ error: 'ID is required for update' });

    const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);
    if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });

    const rowToUpdate = rows[rowIndex];

    if(updatedItem.customerName) rowToUpdate.set('Full Name', updatedItem.customerName);
    if(updatedItem.customerEmail) rowToUpdate.set('Email', updatedItem.customerEmail);
    if(updatedItem.customerPhone) rowToUpdate.set('Phone Number', updatedItem.customerPhone);
    if(updatedItem.course) rowToUpdate.set('Selected Course', updatedItem.course);
    if(updatedItem.qualification) rowToUpdate.set('Qualification', updatedItem.qualification);
    if(updatedItem.experience) rowToUpdate.set('Experience', updatedItem.experience);
    if(updatedItem.status) rowToUpdate.set('Payment Status', updatedItem.status);
    if(updatedItem.paymentMethod) rowToUpdate.set('Payment Method', updatedItem.paymentMethod);
    if(updatedItem.finalAmount) rowToUpdate.set('Amount', updatedItem.finalAmount);
    if(updatedItem.transactionId) rowToUpdate.set('Transaction ID', updatedItem.transactionId);
    if(updatedItem.language) rowToUpdate.set('Lang', updatedItem.language);
    if(updatedItem.utm_source) rowToUpdate.set('utm_source', updatedItem.utm_source);
    if(updatedItem.utm_medium) rowToUpdate.set('utm_medium', updatedItem.utm_medium);
    if(updatedItem.utm_campaign) rowToUpdate.set('utm_campaign', updatedItem.utm_campaign);
    if(updatedItem.utm_term) rowToUpdate.set('utm_term', updatedItem.utm_term);
    if(updatedItem.utm_content) rowToUpdate.set('utm_content', updatedItem.utm_content);

    // (NEW) تسجيل من قام بالتعديل
    rowToUpdate.set('Last Updated By', user ? user.email : 'System');

    await rowToUpdate.save();
    res.status(200).json({ success: true, message: 'Record updated successfully' });
}

async function handleDelete(req, res) {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });

    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();

    const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);
    if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });

    await rows[rowIndex].delete();
    res.status(200).json({ success: true, message: 'Record deleted successfully' });
}

// ===================================================================
// 6. دوال إدارة الموظفين (New Functions)
// ===================================================================

async function handleAddUser(req, res) {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'البيانات ناقصة' });

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { role: role || 'staff' }
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ success: true, user: data.user });
}

async function handleListUsers(req, res) {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return res.status(400).json({ error: error.message });
    
    const cleanUsers = users.map(u => ({
        id: u.id,
        email: u.email,
        role: u.user_metadata?.role || 'staff',
        last_sign_in: u.last_sign_in_at,
        created_at: u.created_at
    }));
    
    return res.status(200).json({ users: cleanUsers });
}

async function handleDeleteUser(req, res) {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ success: true });
}

// ===================================================================
// 7. دوال تطبيع الأسماء (Normalizing - Original)
// ===================================================================

const COURSE_DEFINITIONS = {
    'PMP': ['Gestion de Projet Professionnelle (PMP®)', 'Professional Project Management (PMP®)', 'الإدارة الاحترافية للمشاريع (PMP®)'],
    'Planning': ['Préparation et Planification de Chantier', 'Site Preparation and Planning', 'إعداد وتخطيط المواقع'],
    'QSE': ['Normes QSE en Chantier', 'QSE Standards on Sites', 'معايير QSE في المواقع'],
    'Soft Skills': ['Soft Skills pour Managers', 'Soft Skills for Managers', 'المهارات الناعمة للمديرين']
};

function normalizeCourseName(raw) {
    if (!raw) return 'دورات أخرى';
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'n/a') return 'غير محدد';
    const lower = trimmed.toLowerCase();
    if (lower.includes('pmp')) return 'PMP';
    if (lower.includes('planning')) return 'Planning';
    if (lower.includes('qse')) return 'QSE';
    if (lower.includes('softskills') || lower.includes('soft skills')) return 'Soft Skills';
    for (const shortcode in COURSE_DEFINITIONS) {
        for (const t of COURSE_DEFINITIONS[shortcode]) {
            if (t && typeof t === 'string' && t.trim().toLowerCase() === trimmed.toLowerCase()) return shortcode;
        }
    }
    return 'دورات أخرى';
}
