import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

// --- Configuration & Constants ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024'; // Master Key

// Supabase Config (Must be in Env Variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
// هام: نستخدم Service Role Key لإدارة المستخدمين (إنشاء/حذف)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

// Initialize Supabase Admin Client
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) 
    : null;

// --- Helper Functions ---

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

// دالة للتحقق من الفلاتر (نفس المنطق السابق)
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
    // (نفس دالة الحسابات السابقة تماماً)
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
                break;
            case 'failed':
                stats.failedPayments++; stats.failedRevenue += amount;
                break;
            case 'canceled':
            case 'cancelled':
                stats.canceledPayments++; stats.canceledRevenue += amount;
                break;
        }
    }
    return stats;
}

// Normalize Helper
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

// --- Authentication Helper ---

// تقوم بفك تشفير الكوكي وإرجاع كائن المستخدم والصلاحية
function getAuthenticatedUser(req) {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/admin_session=([^;]+)/);
    
    if (!match) return null;

    try {
        const token = match[1];
        // فك التشفير (Base64)
        const sessionStr = Buffer.from(token, 'base64').toString('utf8');
        const session = JSON.parse(sessionStr);
        return session; // { email, role, name }
    } catch (e) {
        return null;
    }
}

// --- Main Handler ---

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

    // Routing Logic
    try {
        const path = req.url || '';

        // 1. Login/Logout
        if (path.includes('/login') && req.method === 'POST') return handleLogin(req, res);
        if (path.includes('/logout') && req.method === 'POST') return handleLogout(req, res);

        // Check Auth for all other routes
        const user = getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. User Management Routes (Only for Super Admin - except change password)
        if (path.includes('/users') && req.method === 'GET') return handleGetUsers(req, res, user);
        if (path.includes('/add-user') && req.method === 'POST') return handleAddUser(req, res, user);
        if (path.includes('/delete-user') && req.method === 'DELETE') return handleDeleteUser(req, res, user);
        if (path.includes('/change-password') && req.method === 'POST') return handleChangePassword(req, res, user);

        // 3. Data Operations (Google Sheets)
        if (req.method === 'GET') return handleGet(req, res, user);
        if (req.method === 'POST') return handlePost(req, res, user);
        if (req.method === 'PUT') return handlePut(req, res, user);
        if (req.method === 'DELETE') return handleDelete(req, res, user);

        return res.status(404).json({ error: 'Route not found' });

    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

// --- Handlers ---

async function handleLogin(req, res) {
    const { username, password } = req.body || {}; // username can be email
    
    // 1. Check Backdoor (Master Key)
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const session = { role: 'super_admin', email: 'master@system', name: 'Super Admin' };
        return setSessionCookie(res, session);
    }

    // 2. Check Supabase Auth
    if (supabase) {
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: username,
                password: password
            });

            if (error || !data.user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Fetch Role from user_roles table
            const { data: roleData } = await supabase
                .from('user_roles')
                .select('role')
                .eq('user_id', data.user.id)
                .single();

            const role = roleData?.role || 'editor'; // Default to editor if not found

            const session = { 
                role: role, 
                email: data.user.email, 
                userId: data.user.id,
                name: data.user.user_metadata?.full_name || username 
            };
            return setSessionCookie(res, session);

        } catch (e) {
            console.error('Supabase Login Error:', e);
            return res.status(500).json({ error: 'Auth Provider Error' });
        }
    }

    return res.status(401).json({ error: 'Authentication failed' });
}

function setSessionCookie(res, sessionObj) {
    const sessionStr = JSON.stringify(sessionObj);
    const token = Buffer.from(sessionStr).toString('base64');
    const maxAge = 24 * 60 * 60; 
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookie = `admin_session=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=None${secureFlag}`;
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ success: true, user: sessionObj });
}

async function handleLogout(req, res) {
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookie = `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=None${secureFlag}`;
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ success: true });
}

// --- User Management Handlers ---

async function handleGetUsers(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    
    // إذا كان الماستر هو المتصل، نعيد قائمة الموظفين من Supabase
    if (!supabase) return res.status(503).json({ error: 'User management not configured' });

    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) return res.status(500).json({ error: error.message });

    // نحتاج لجلب الأدوار أيضاً لدمجها
    const { data: roles } = await supabase.from('user_roles').select('*');

    const cleanUsers = users.map(u => {
        const roleInfo = roles.find(r => r.user_id === u.id);
        return {
            id: u.id,
            email: u.email,
            last_sign_in: u.last_sign_in_at,
            created_at: u.created_at,
            role: roleInfo ? roleInfo.role : 'editor'
        };
    });

    return res.json({ data: cleanUsers });
}

async function handleAddUser(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

    if (!supabase) return res.status(503).json({ error: 'Supabase not connected' });

    // 1. Create User in Auth
    const { data: user, error } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { full_name: fullName }
    });

    if (error) return res.status(400).json({ error: error.message });

    // 2. Add Role (Default to editor)
    const { error: roleError } = await supabase.from('user_roles').insert({
        user_id: user.user.id,
        role: 'editor' // Default role for created employees
    });

    if (roleError) return res.status(500).json({ error: 'User created but role assignment failed' });

    return res.json({ success: true, message: 'Employee added successfully' });
}

async function handleDeleteUser(req, res, currentUser) {
    if (currentUser.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });

    // Role will be deleted via Cascade if configured in SQL, otherwise:
    await supabase.from('user_roles').delete().eq('user_id', userId);

    return res.json({ success: true });
}

async function handleChangePassword(req, res, currentUser) {
    const { newPassword, targetUserId } = req.body;
    
    // إذا كان سوبر أدمن ويغير لغيره، أو يغير لنفسه
    // إذا كان محرر، لا يمكنه تغيير كلمة مرور غيره
    let uidToUpdate = currentUser.userId;
    
    if (currentUser.role === 'super_admin' && targetUserId) {
        uidToUpdate = targetUserId;
    } else if (currentUser.role === 'super_admin' && !targetUserId && currentUser.email === 'master@system') {
         // Master can't change env var password via API
         return res.status(400).json({ error: 'Cannot change Master Key via API' });
    }

    if (!supabase) return res.status(503).json({ error: 'Service unavailable' });

    const { error } = await supabase.auth.admin.updateUserById(uidToUpdate, {
        password: newPassword
    });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true });
}

// --- Sheet Operations Handlers (Updated with Audit Trail) ---

async function handleGet(req, res, user) {
    // ... (الكود السابق مع إضافة بسيطة: إرجاع بيانات المستخدم الحالي للواجهة)
    const { searchTerm, statusFilter, paymentFilter, courseFilter, dateFilter, startDate, endDate } = req.query;

    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();

    const data = rows.map(row => ({
        // ... (نفس الحقول السابقة)
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
        lastUpdatedBy: row.get('Last Updated By') || '', // NEW FIELD
        parsedDate: parseDate(row.get('Timestamp') || ''),
        normalizedCourse: normalizeCourseName(row.get('Selected Course') || '')
    }));
    
    const overallStats = calculateStatistics(data);
    const isFiltered = !!(searchTerm || statusFilter || paymentFilter || (dateFilter && dateFilter !== 'all'));

    let filteredData = data;
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
    const filteredStats = calculateStatistics(filteredData);

    res.status(200).json({
        success: true,
        user: { role: user.role, email: user.email }, // أرسل بيانات المستخدم للواجهة
        statistics: { overall: overallStats, filtered: filteredStats },
        data: filteredData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0)),
        isFiltered: isFiltered
    });
}

async function handlePost(req, res, user) {
    // Audit Trail: We know who is 'user'
    try {
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
            'Last Updated By': user.email // Audit Trail
        });

        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function handlePut(req, res, user) {
    try {
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();
        const updatedItem = req.body;
        const id = updatedItem.originalInquiryId;

        const rowToUpdate = rows.find(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);

        if (!rowToUpdate) return res.status(404).json({ error: 'Record not found' });

        // Update fields
        const fields = ['Full Name', 'Email', 'Phone Number', 'Selected Course', 'Qualification', 'Experience', 'Payment Status', 'Payment Method', 'Amount', 'Transaction ID', 'Lang', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
        
        // Mapping
        const map = {
            'Full Name': updatedItem.customerName,
            'Email': updatedItem.customerEmail,
            'Phone Number': updatedItem.customerPhone,
            'Selected Course': updatedItem.course,
            'Qualification': updatedItem.qualification,
            'Experience': updatedItem.experience,
            'Payment Status': updatedItem.status,
            'Payment Method': updatedItem.paymentMethod,
            'Amount': updatedItem.finalAmount,
            'Transaction ID': updatedItem.transactionId,
            'Lang': updatedItem.language,
            // UTMs...
        };

        // تحديث الحقول الموجودة فقط
        if (updatedItem.customerName) rowToUpdate.set('Full Name', updatedItem.customerName);
        if (updatedItem.customerEmail) rowToUpdate.set('Email', updatedItem.customerEmail);
        if (updatedItem.customerPhone) rowToUpdate.set('Phone Number', updatedItem.customerPhone);
        if (updatedItem.course) rowToUpdate.set('Selected Course', updatedItem.course);
        if (updatedItem.qualification) rowToUpdate.set('Qualification', updatedItem.qualification);
        if (updatedItem.experience) rowToUpdate.set('Experience', updatedItem.experience);
        if (updatedItem.status) rowToUpdate.set('Payment Status', updatedItem.status);
        if (updatedItem.paymentMethod) rowToUpdate.set('Payment Method', updatedItem.paymentMethod);
        if (updatedItem.finalAmount) rowToUpdate.set('Amount', updatedItem.finalAmount);
        if (updatedItem.transactionId) rowToUpdate.set('Transaction ID', updatedItem.transactionId);
        if (updatedItem.language) rowToUpdate.set('Lang', updatedItem.language);
        
        if (updatedItem.utm_source) rowToUpdate.set('utm_source', updatedItem.utm_source);
        if (updatedItem.utm_medium) rowToUpdate.set('utm_medium', updatedItem.utm_medium);
        if (updatedItem.utm_campaign) rowToUpdate.set('utm_campaign', updatedItem.utm_campaign);

        // Audit Trail
        rowToUpdate.set('Last Updated By', user.email);

        await rowToUpdate.save();
        res.status(200).json({ success: true });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function handleDelete(req, res, user) {
    // RBAC Check: Only Super Admin can delete rows
    if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission Denied: Only Admins can delete records.' });
    }

    try {
        const { id } = req.body;
        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();
        const row = rows.find(r => r.get('Inquiry ID') === id || r.get('Transaction ID') === id);

        if (!row) return res.status(404).json({ error: 'Not found' });
        await row.delete();

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// --- Google Sheet Connection ---
async function getGoogleSheet() {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    }));
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["Leads"] || doc.sheetsByIndex[0];
    return sheet;
}
