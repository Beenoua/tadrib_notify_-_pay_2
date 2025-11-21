import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

// 1. إعدادات Supabase (للمستخدمين والصلاحيات)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: Missing Supabase Credentials in .env');
}

// تهيئة عميل Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Simple authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

// 2. إعدادات Google Sheets (للبيانات)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

/**
 * ===================================================================
 * Main Handler (الموجه الرئيسي)
 * ===================================================================
 */
export default async function handler(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    try {
        // 1. مسارات عامة (تسجيل الدخول والخروج) - عبر Supabase
        if (req.method === 'POST' && req.url.includes('/login')) return handleLogin(req, res);
        if (req.method === 'POST' && req.url.includes('/logout')) return handleLogout(req, res);

        // 2. التحقق من المستخدم (Middleware)
        const user = await authenticate(req, res);
        if (!user) return; // authenticate ترسل الرد عند الفشل

        // 3. مسارات إدارة الموظفين (Supabase Management)
        if (req.url.includes('/add-user') && req.method === 'POST') return handleAddUser(req, res, user);
        if (req.url.includes('/change-password') && req.method === 'POST') return handleChangePassword(req, res, user);
        if (req.url.includes('/users') && req.method === 'GET') return handleGetUsers(req, res, user);
        if (req.url.includes('/delete-user') && req.method === 'DELETE') return handleDeleteUser(req, res, user);

        // 4. مسارات البيانات (Google Sheets Operations)
        if (req.method === 'GET') return handleGetLeads(req, res);
        if (req.method === 'POST') return handlePostLead(req, res); // إضافة معاملة
        if (req.method === 'PUT') return handlePutLead(req, res);   // تعديل معاملة
        if (req.method === 'DELETE') return handleDeleteLead(req, res); // حذف معاملة

        return res.status(404).json({ error: 'Endpoint not found' });

    } catch (error) {
        console.error('Server Fatal Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

// ===================================================================
// دوال المصادقة (Supabase Auth Logic)
// ===================================================================

async function authenticate(req, res) {
    const cookieHeader = req.headers.cookie || '';
    let token = null;

    // استخراج التوكن من الكوكيز أو الهيدر
    if (cookieHeader.includes('sb_access_token=')) {
        token = cookieHeader.split('sb_access_token=')[1].split(';')[0];
    } else if (req.headers.authorization) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return null;
    }

    // التحقق من صحة التوكن مع Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }

    // جلب الصلاحية (Role) من جدول user_roles
    const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('id', user.id)
        .single();

    // إرجاع كائن المستخدم مع دوره (افتراضي editor)
    return { ...user, role: roleData?.role || 'editor' };
}

async function handleLogin(req, res) {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Credentials required' });

    // تسجيل الدخول
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) return res.status(401).json({ error: error.message });

    // جلب الدور
    const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('id', data.user.id)
        .single();
    
    const role = roleData?.role || 'editor';

    // إعداد الكوكيز (Secure & HttpOnly)
    const maxAge = 60 * 60 * 24 * 7; // أسبوع
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const sameSite = 'None'; 
    
    res.setHeader('Set-Cookie', [
        `sb_access_token=${data.session.access_token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secureFlag}`,
        `user_role=${role}; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secureFlag}`
    ]);

    return res.status(200).json({ success: true, role, user: { email: data.user.email } });
}

async function handleLogout(req, res) {
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    // تصفير الكوكيز
    res.setHeader('Set-Cookie', [
        `sb_access_token=; HttpOnly; Path=/; Max-Age=0; SameSite=None${secureFlag}`,
        `user_role=; Path=/; Max-Age=0; SameSite=None${secureFlag}`
    ]);
    return res.status(200).json({ success: true });
}

// ===================================================================
// إدارة الموظفين (User Management - Admin Only)
// ===================================================================

async function handleAddUser(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden: Super Admin only' });

    const { email, password, role } = req.body;
    
    // إنشاء المستخدم في Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true
    });

    if (authError) return res.status(400).json({ error: authError.message });

    // إضافة الدور في الجدول
    const { error: roleError } = await supabase
        .from('user_roles')
        .insert([{ id: authData.user.id, email, role: role || 'editor' }]);

    if (roleError) {
        await supabase.auth.admin.deleteUser(authData.user.id); // تراجع في حال الفشل
        return res.status(500).json({ error: 'Role assignment failed' });
    }

    return res.status(201).json({ success: true });
}

async function handleGetUsers(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { data, error } = await supabase.from('user_roles').select('*');
    if (error) return res.status(500).json({ error: error.message });
    
    return res.status(200).json({ success: true, data });
}

async function handleDeleteUser(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { id } = req.body;
    const { error } = await supabase.auth.admin.deleteUser(id); // الحذف Cascade
    if (error) return res.status(500).json({ error: error.message });
    
    return res.status(200).json({ success: true });
}

async function handleChangePassword(req, res, currentUser) {
    const { newPassword } = req.body;
    // تحديث كلمة مرور المستخدم الحالي
    const { error } = await supabase.auth.admin.updateUserById(currentUser.id, { password: newPassword });
    
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
}

// ===================================================================
// عمليات البيانات (Google Sheets Logic)
// ===================================================================

async function getGoogleSheet() {
    if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
        throw new Error('Missing Google Sheets Credentials');
    }
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();
    return doc.sheetsByTitle["Leads"] || doc.sheetsByIndex[0];
}

// --- جلب البيانات (GET) ---
async function handleGetLeads(req, res) {
    try {
        const { searchTerm, statusFilter, paymentFilter, courseFilter, dateFilter, startDate, endDate } = req.query;
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();

        // تحويل الصفوف إلى كائنات (Mapping)
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
            currency: 'MAD',
            language: row.get('Lang') || 'ar',
            utm_source: row.get('utm_source') || '',
            utm_medium: row.get('utm_medium') || '',
            utm_campaign: row.get('utm_campaign') || '',
            utm_term: row.get('utm_term') || '',
            utm_content: row.get('utm_content') || '',
            parsedDate: parseDate(row.get('Timestamp') || ''),
            normalizedCourse: normalizeCourseName(row.get('Selected Course') || '')
        }));

        // حساب الإحصائيات
        const overallStats = calculateStatistics(data);
        let filteredData = data;
        
        if (searchTerm || statusFilter || paymentFilter || (dateFilter && dateFilter !== 'all')) {
            filteredData = data.filter(item => {
                const search = searchTerm ? searchTerm.toLowerCase() : '';
                const matchesSearch = !search || Object.values(item).some(v => String(v).toLowerCase().includes(search));
                const matchesStatus = !statusFilter || item.status === statusFilter;
                const matchesPayment = !paymentFilter || item.paymentMethod === paymentFilter;
                const matchesCourse = !courseFilter || courseFilter === '' || (item.normalizedCourse === courseFilter);
                const matchesDate = checkDateFilter(item, dateFilter, startDate, endDate);
                return matchesSearch && matchesStatus && matchesPayment && matchesCourse && matchesDate;
            });
        }
        
        const filteredStats = calculateStatistics(filteredData);

        res.status(200).json({
            success: true,
            statistics: { overall: overallStats, filtered: filteredStats },
            data: filteredData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0))
        });
    } catch (error) {
        console.error('GET Leads Error:', error);
        res.status(500).json({ error: 'Error fetching leads' });
    }
}

// --- إضافة معاملة (POST) ---
async function handlePostLead(req, res) {
    try {
        const sheet = await getGoogleSheet();
        const newItem = req.body;
        
        // الحفظ في الشيت (بدون تيليجرام)
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
            'Last4Digits': newItem.last4 || ''
        });
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('POST Lead Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// --- تعديل معاملة (PUT) ---
async function handlePutLead(req, res) {
    try {
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();
        const updatedItem = req.body;
        const id = updatedItem.originalInquiryId;

        const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);
        if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });

        const row = rows[rowIndex];
        const fieldsMapping = {
            'Full Name': 'customerName', 'Email': 'customerEmail', 'Phone Number': 'customerPhone',
            'Selected Course': 'course', 'Qualification': 'qualification', 'Experience': 'experience',
            'Payment Status': 'status', 'Payment Method': 'paymentMethod', 'Transaction ID': 'transactionId',
            'Amount': 'finalAmount', 'Lang': 'language', 'utm_source': 'utm_source', 
            'utm_medium': 'utm_medium', 'utm_campaign': 'utm_campaign', 'utm_content': 'utm_content'
        };

        for (const [sheetCol, reqKey] of Object.entries(fieldsMapping)) {
            if (updatedItem[reqKey] !== undefined) row.set(sheetCol, updatedItem[reqKey]);
        }

        await row.save();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('PUT Lead Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// --- حذف معاملة (DELETE) ---
async function handleDeleteLead(req, res) {
    try {
        const { id } = req.body;
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();
        const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);

        if (rowIndex === -1) return res.status(404).json({ error: 'Record not found' });

        await rows[rowIndex].delete();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('DELETE Lead Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// ===================================================================
// دوال مساعدة (Helpers)
// ===================================================================

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
        case 'hour': startDate = new Date(now.getTime() - (3600000)); break;
        case 'day': startDate = new Date(now.getTime() - (86400000)); break;
        case 'week': startDate = new Date(now.getTime() - (604800000)); break;
        case 'month': startDate = new Date(now.getTime() - (2592000000)); break;
        case '3month': startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
        case '6month': startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
        case 'year': startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
        case 'custom':
            if (customStart && customEnd) {
                const start = new Date(customStart + 'T00:00:00'); 
                const end = new Date(customEnd + 'T23:59:59');
                return itemDate >= start && itemDate <= end;
            }
            return true;
        default: return true;
    }
    return itemDate >= startDate;
}

function calculateStatistics(dataArray) {
    const stats = {
        totalPayments: dataArray.length, paidPayments: 0, pendingPayments: 0, failedPayments: 0, canceledPayments: 0,
        cashplusPayments: 0, cardPayments: 0, cashCount: 0, bankCount: 0,
        arabicUsers: 0, frenchUsers: 0, englishUsers: 0,
        netRevenue: 0, pendingRevenue: 0, failedRevenue: 0, canceledRevenue: 0,
        paid_cashplus: 0, paid_card: 0, paid_cash: 0, paid_bank: 0,
        net_cashplus_revenue: 0, net_card_revenue: 0, net_cash_revenue: 0, net_bank_revenue: 0
    };

    for (const item of dataArray) {
        const amount = parseFloat(item.finalAmount) || 0;
        const pm = (item.paymentMethod || '').toLowerCase();
        
        if (pm === 'cashplus') stats.cashplusPayments++;
        else if (pm.includes('card')) stats.cardPayments++;
        else if (pm === 'cash') stats.cashCount++;
        else if (pm.includes('bank')) stats.bankCount++;

        if (item.language === 'ar') stats.arabicUsers++;
        if (item.language === 'fr') stats.frenchUsers++;
        if (item.language === 'en') stats.englishUsers++;

        switch (item.status) {
            case 'paid':
                stats.paidPayments++; stats.netRevenue += amount;
                if (pm === 'cashplus') { stats.paid_cashplus++; stats.net_cashplus_revenue += amount; }
                else if (pm.includes('card')) { stats.paid_card++; stats.net_card_revenue += amount; }
                else if (pm === 'cash') { stats.paid_cash++; stats.net_cash_revenue += amount; }
                else if (pm.includes('bank')) { stats.paid_bank++; stats.net_bank_revenue += amount; }
                break;
            case 'pending':
            case 'pending_cashplus':
                stats.pendingPayments++; stats.pendingRevenue += amount;
                break;
            case 'failed':
                stats.failedPayments++; stats.failedRevenue += amount;
                break;
            case 'canceled':
                stats.canceledPayments++; stats.canceledRevenue += amount;
                break;
        }
    }
    return stats;
}

const COURSE_DEFINITIONS = {
    'PMP': ['PMP', 'Gestion de Projet', 'الإدارة الاحترافية'],
    'Planning': ['Planning', 'Planification', 'إعداد وتخطيط'],
    'QSE': ['QSE', 'Normes QSE', 'معايير QSE'],
    'Soft Skills': ['Soft Skills', 'المهارات الناعمة']
};

function normalizeCourseName(raw) {
    if (!raw) return 'Other';
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'n/a') return 'Other';
    for (const shortcode in COURSE_DEFINITIONS) {
        for (const t of COURSE_DEFINITIONS[shortcode]) {
            if (trimmed.toLowerCase().includes(t.toLowerCase())) return shortcode;
        }
    }
    return trimmed;
}
