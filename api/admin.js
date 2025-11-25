import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
// ملاحظة: تأكد من أن ملف utils.js موجود إذا كنت تستخدمه
// import { validateRequired, validateEmail } from './utils.js'; 
// أضف مكتبة Supabase هنا
import { createClient } from '@supabase/supabase-js';

// إعدادات المصادقة الأصلية (الباب الخلفي)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

// إعدادات Supabase (تأكد من إضافتها في ملف .env)
const SUPABASE_URL = process.env.SUPABASE_URL;
// تنبيه: نحتاج Service Role Key لإدارة المستخدمين (إنشاء/حذف)، وليس المفتاح العام
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    } catch (error) {
        console.warn('Supabase initialization failed:', error.message);
    }
} else {
    console.warn('Supabase credentials missing. Running in Backdoor-Only mode.');
}

// ===================================================================
// (NEW) دوال مساعدة تم جلبها من الواجهة الأمامية
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
    const itemDate = item.parsedDate; // (تعديل) نفترض أن item.parsedDate موجود
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
// User Management Handlers (New)
// ===================================================================

// جلب قائمة المستخدمين
async function handleGetUsers(res) {
    // 1. جلب المستخدمين من Auth
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    // 2. جلب تفاصيل الأدوار (Roles & Frozen Status) لجميع المستخدمين
    const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role, is_frozen, can_edit, can_view_stats');

    // تحويل المصفوفة إلى Map لسهولة البحث
    const rolesMap = {};
    if (rolesData) {
        rolesData.forEach(r => rolesMap[r.user_id] = r);
    }

    // 3. دمج البيانات
    const usersList = users.map(u => {
        const r = rolesMap[u.id] || {};
        return {
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            role: r.role || 'editor',
            is_frozen: !!r.is_frozen,
            can_edit: !!r.can_edit,
            can_view_stats: !!r.can_view_stats
        };
    });

    return res.status(200).json({ success: true, data: usersList });
}

// تحديث بيانات الموظف (نسخة العميل المعزول الآمنة)
async function handleUpdateUser(req, res) {
    const { userId, role, can_edit, can_view_stats, is_frozen } = req.body;

    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    // إنشاء عميل معزول (كما اتفقنا سابقاً)
    const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    try {
        const { data: { user }, error: fetchError } = await adminClient.auth.admin.getUserById(userId);
        
        if (fetchError || !user) {
            return res.status(404).json({ error: 'User not found in Auth' });
        }

        // --- التغيير هنا ---
        // أضفنا .select() لنرى ما تم كتابته في القاعدة
        const { data, error } = await adminClient
            .from('user_roles')
            .upsert({ 
                user_id: userId,
                email: user.email,
                role: role,
                can_edit: role === 'super_admin' ? true : can_edit,
                can_view_stats: role === 'super_admin' ? true : can_view_stats,
                is_frozen: is_frozen
            }, { onConflict: 'user_id' })
            .select(); // <--- هام جداً: إرجاع السجل المحدث

        if (error) throw error;

        // سنطبع البيانات في سجلات Vercel لنرى هل تغيرت فعلاً
        console.log('Updated Row Data:', data);

        return res.status(200).json({ success: true, message: 'User updated successfully', updatedData: data });

    } catch (error) {
        console.error('Update Role Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// إضافة موظف جديد
async function handleAddUser(req, res) {
const { email, password, role, can_edit, can_view_stats } = req.body;
    // 1. إنشاء المستخدم في Supabase Auth
    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true // تفعيل الحساب مباشرة
    });

    if (createError) throw createError;

    // 2. تعيين الصلاحية في جدول user_roles
    if (userData.user) {
        const { error: roleError } = await supabase
            .from('user_roles')
            .insert([{ 
                user_id: userData.user.id, 
                role: role, 
                email: email,
                // حفظ الصلاحيات
                can_edit: role === 'super_admin' ? true : (can_edit || false),
                can_view_stats: role === 'super_admin' ? true : (can_view_stats || false)
            }]);        
        if (roleError) {
            // تنظيف: حذف المستخدم إذا فشل تعيين الدور
            await supabase.auth.admin.deleteUser(userData.user.id);
            throw roleError;
        }
    }

    return res.status(201).json({ success: true, message: 'User created successfully' });
}

// حذف موظف
async function handleDeleteUser(req, res) {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;

    return res.status(200).json({ success: true, message: 'User deleted' });
}

// تغيير كلمة المرور (للمستخدم نفسه أو من قبل الأدمن)
async function handleChangePassword(req, res, currentUser) {
    const { newPassword, userId } = req.body;
    
    // إذا كان سوبر أدمن ومعه userId -> يغير لأي شخص
    // إذا كان مستخدم عادي -> يغير لنفسه فقط
    const targetId = (currentUser.role === 'super_admin' && userId) ? userId : currentUser.id;

    const { error } = await supabase.auth.admin.updateUserById(
        targetId,
        { password: newPassword }
    );

    if (error) throw error;
    return res.status(200).json({ success: true, message: 'Password updated' });
}


/**
 * ===================================================================
 * Main Handler (Routes requests) - FIXED ROUTING
 * ===================================================================
 */
export default async function handler(req, res) {
    // 1. CORS Setup
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // 2. Preflight Requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // قراءة المعاملات من الرابط
        const { action } = req.query || {}; 

        // 3. Public Routes (Login / Logout)
        // نتحقق من action login أو البحث في الجسم
        if (action === 'login' || (req.method === 'POST' && req.body && req.body.username && !req.headers.authorization)) {
            return handleLogin(req, res);
        }
        if (action === 'logout' || req.url.includes('/logout')) {
            return handleLogout(req, res);
        }

        // 4. Authentication Check
        const user = await authenticateUser(req, res);
        
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized access: Invalid token or credentials' });
        }

        // 5. User Management Routes (Super Admin Only)
        // نستخدم action للتمييز بدلاً من المسار
if (['get_users', 'add_user', 'delete_user', 'change_password', 'update_user'].includes(action)) {            
            // استثناء: تغيير كلمة المرور مسموح للمستخدم لنفسه
            if (user.role !== 'super_admin' && action !== 'change_password') {
                 return res.status(403).json({ error: 'Forbidden: Admins only' });
            }

            if (action === 'get_users') return handleGetUsers(res);
            if (action === 'add_user') return handleAddUser(req, res);
            if (action === 'delete_user') return handleDeleteUser(req, res);
            if (action === 'change_password') return handleChangePassword(req, res, user);
            if (action === 'update_user') return handleUpdateUser(req, res); // <--- إضافة
        }

        // 6. Lead Management Routes (CRUD for Google Sheets)
        if (req.method === 'GET') {
            return handleGet(req, res, user);
        } else if (req.method === 'POST') {
            return handlePost(req, res, user);
        } else if (req.method === 'PUT') {
    // التحقق من صلاحية التعديل
    if (user.role !== 'super_admin' && !user.permissions?.can_edit) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل البيانات' });
    }
    return handlePut(req, res, user);
} else if (req.method === 'DELETE') {
    // التحقق من صلاحية الحذف (عادة نربطها بالتعديل أو نضيف صلاحية delete خاصة)
    if (user.role !== 'super_admin') { // الحذف حصري للآدمن كما اتفقنا سابقاً، أو يمكن ربطه بـ can_edit
         return res.status(403).json({ error: 'الحذف مقتصر على المدير العام' });
    }
    return handleDelete(req, res, user);
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Handler Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

/**
 * ===================================================================
 * (POST) Login - Hybrid (Backdoor First, then Supabase)
 * ===================================================================
 */
async function handleLogin(req, res) {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // 1. Check Backdoor (Environment Variables)
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const maxAge = 24 * 60 * 60; // 1 day
            const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            const sameSite = 'None';
            // نضع كوكي خاص بالأدمن
            const cookie = `admin_session=1; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secureFlag}`;
            res.setHeader('Set-Cookie', cookie);
            
            return res.status(200).json({ 
                success: true, 
                message: 'Logged in as Super Admin',
                role: 'super_admin',
                type: 'backdoor'
            });
        }

        // 2. Supabase Check (فقط إذا كان مفعلاً)
        if (supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: username,
                password: password
            });

            if (!error && data.user && data.session) {
                const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, can_edit, can_view_stats') // جلب الصلاحيات الجديدة
    .eq('user_id', data.user.id)
    .single();

return res.status(200).json({
    success: true,
    message: 'Logged in via Supabase',
    token: data.session.access_token,
    role: roleData?.role || 'editor',
    // نرسل كائن الصلاحيات للواجهة
    permissions: {
        can_edit: roleData?.role === 'super_admin' ? true : (roleData?.can_edit ?? false),
        can_view_stats: roleData?.role === 'super_admin' ? true : (roleData?.can_view_stats ?? false)
    },
    type: 'supabase'
});
            }
        } else {
             console.warn('Login attempted via Supabase but Supabase is not configured.');
        }

        return res.status(401).json({ error: 'Invalid credentials' });

    } catch (error) {
        console.error('Login error', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * ===================================================================
 * (GET) Fetches records and statistics (MODIFIED)
 * ===================================================================
 */
async function handleGet(req, res, user) {
    try {

        // (NEW) قراءة الفلاتر من الرابط
        const {
            searchTerm,
            statusFilter,
            paymentFilter,
            courseFilter,
            dateFilter,
            startDate,
            endDate
        } = req.query;

        const sheet = await getGoogleSheet(); // Connect to sheet
        const rows = await sheet.getRows();

        let data = rows.map(row => ({
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
            // إضافة حقل التتبع الجديد للعرض أيضاً
            lastUpdatedBy: row.get('Last Updated By') || '',
            // (NEW) إضافة تاريخ مهيأ للفلترة
            parsedDate: parseDate(row.get('Timestamp') || ''),
            normalizedCourse: normalizeCourseName(row.get('Selected Course') || '')
        }));
// --- (SECURITY FILTER) الفلتر الأمني للمحررين ---
        // إذا لم يكن سوبر أدمن، نحذف المعاملات المدفوعة نهائياً من القائمة
        if (user.role !== 'super_admin') {
            data = data.filter(item => item.status.toLowerCase() !== 'paid');
        }
        // --- (NEW) منطق الفلترة والحساب المركزي ---

        // 1. حساب الإحصائيات الإجمالية (دائماً)
        const overallStats = calculateStatistics(data);

        // 2. التحقق إذا كانت هناك فلاتر نشطة
        const isFiltered = !!(searchTerm || statusFilter || paymentFilter || (dateFilter && dateFilter !== 'all'));

        let filteredData = data;
        let filteredStats = overallStats;

        if (isFiltered) {
            // 3. تطبيق الفلاتر
            filteredData = data.filter(item => {
                const search = searchTerm ? searchTerm.toLowerCase() : '';
                const matchesSearch = !search ||
                    Object.values(item).some(val =>
                        String(val).toLowerCase().includes(search)
                    );
                const matchesStatus = !statusFilter || item.status === statusFilter;
                const matchesPayment = !paymentFilter || item.paymentMethod === paymentFilter;
                const matchesCourse = !courseFilter || courseFilter === '' || (item.normalizedCourse && item.normalizedCourse === courseFilter);
                const matchesDate = checkDateFilter(item, dateFilter, startDate, endDate);

                return matchesSearch && matchesStatus && matchesPayment && matchesCourse && matchesDate;
            });

            // 4. حساب الإحصائيات المفلترة
            filteredStats = calculateStatistics(filteredData);
        }

        // 5. إرجاع البيانات المفلترة + كلا الإحصائيات
        res.status(200).json({
            success: true,
            statistics: {
                overall: overallStats,
                filtered: filteredStats
            },
            data: filteredData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0)), // إرجاع البيانات المفلترة فقط
            isFiltered: isFiltered,
            currentUser: { email: user.email, role: user.role } // نرسل معلومات المستخدم الحالي للواجهة
        });

    } catch (error) {
        console.error('Admin GET API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * ===================================================================
 * (POST) Creates a new record (لم يتغير)
 * ===================================================================
 */
async function handlePost(req, res, user) {
    try {

        const sheet = await getGoogleSheet();

        const newItem = req.body;

        // إضافة صف جديد مع ربط دقيق لكل الأعمدة في Google Sheets
        await sheet.addRow({
            'Timestamp': new Date().toISOString(),
            'Inquiry ID': newItem.inquiryId,
            'Full Name': newItem.customerName,
            'Email': newItem.customerEmail,
            'Phone Number': newItem.customerPhone,

            // الحقول التي كانت مفقودة
            'Selected Course': newItem.course,
            'Qualification': newItem.qualification || 'Not Specified',
            'Experience': newItem.experience || 'Not Specified',

            'Payment Status': newItem.status,
            'Payment Method': newItem.paymentMethod,

            // الربط الصحيح لرقم المعاملة والعملة
            'Transaction ID': newItem.transactionId || '',
            'Currency': 'MAD', // قيمة ثابتة دائماً
            'Amount': newItem.finalAmount,

            'Lang': newItem.language,

            // كل حقول UTM
            'utm_source': newItem.utm_source || 'manual_entry',
            'utm_medium': newItem.utm_medium || '',
            'utm_campaign': newItem.utm_campaign || '',
            'utm_term': newItem.utm_term || '',
            'utm_content': newItem.utm_content || '',

            // الحقول التقنية الإضافية (اختياري حسب جدولك)
            'CashPlus Code': newItem.cashplusCode || '',
            'Last4Digits': newItem.last4 || '',
            'Last Updated By': user.email // <--- الإضافة الجديدة
        });

        res.status(201).json({
            success: true,
            message: 'Record created successfully'
        });

    } catch (error) {
        console.error('Admin POST API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
        
    }
}


/**
 * ===================================================================
 * (PUT) Updates an existing record (لم يتغير)
 * ===================================================================
 */
async function handlePut(req, res, user) {
    try {

        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();

        const updatedItem = req.body;
        const id = updatedItem.originalInquiryId; // نستخدم المعرف الأصلي للبحث

        if (!id) {
            return res.status(400).json({ error: 'ID is required for update' });
        }

        // البحث عن الصف
        const rowIndex = rows.findIndex(row =>
            row.get('Inquiry ID') === id || row.get('Transaction ID') === id
        );

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }

        const rowToUpdate = rows[rowIndex];

        // --- (SECURITY CHECK) التحقق الأمني قبل التعديل ---
        const currentStatus = (rowToUpdate.get('Payment Status') || '').toLowerCase();

        // إذا لم يكن سوبر أدمن، وكانت الحالة الحالية "مدفوع"، نمنع التعديل
        // (هذا حماية إضافية في حال حاول استدعاء الـ API مباشرة لمعاملة مدفوعة)
        if (user.role !== 'super_admin') {
             // شرط 1: لا يمكنه تعديل معاملة هي أصلاً مدفوعة
            if (currentStatus === 'paid') {
                return res.status(403).json({ error: 'لا تملك صلاحية تعديل المعاملات المدفوعة.' });
            }
            
            // شرط 2: التحقق من صلاحية التعديل العامة (التي أضفناها سابقاً)
            if (!user.permissions?.can_edit) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل البيانات' });
            }
        }

        // تحديث شامل لكل الحقول
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

        // تحديث UTMs
        if (updatedItem.utm_source) rowToUpdate.set('utm_source', updatedItem.utm_source);
        if (updatedItem.utm_medium) rowToUpdate.set('utm_medium', updatedItem.utm_medium);
        if (updatedItem.utm_campaign) rowToUpdate.set('utm_campaign', updatedItem.utm_campaign);
        if (updatedItem.utm_term) rowToUpdate.set('utm_term', updatedItem.utm_term);
        if (updatedItem.utm_content) rowToUpdate.set('utm_content', updatedItem.utm_content);
        rowToUpdate.set('Last Updated By', user.email); // <--- الإضافة الجديدة
        await rowToUpdate.save();

        res.status(200).json({
            success: true,
            message: 'Record updated successfully'
        });

    } catch (error) {
        console.error('Admin PUT API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * ===================================================================
 * (DELETE) Deletes an existing record (لم يتغير)
 * ===================================================================
 */
async function handleDelete(req, res, user) {
    try {
        // ... (باقي الكود لم يتغير)
        // --- (START) (FIX) إصلاح وظيفة الحذف ---
        // كان هذا مفقوداً، مما تسبب في فشل كل عمليات الحذف
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        // --- (END) (FIX) ---

        const sheet = await getGoogleSheet(); // Connect to sheet
        const rows = await sheet.getRows();

        // Find the row with matching id (inquiryId or transactionId)
        const rowIndex = rows.findIndex(row =>
            row.get('Inquiry ID') === id || row.get('Transaction ID') === id
        );

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Delete the row
        await rows[rowIndex].delete();

        res.status(200).json({
            success: true,
            message: 'Record deleted successfully'
        });

    } catch (error) {
        console.error('Admin DELETE API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


/**
 * ===================================================================
 * Hybrid Authentication Helper (New)
 * ===================================================================
 * تتحقق من "الباب الخلفي" أولاً، ثم تتحقق من Supabase.
 * تعيد كائن المستخدم وصلاحيته إذا نجح الدخول.
 */
async function authenticateUser(req, res) {
    // 1. التحقق من الباب الخلفي (Env Variables) - للمشرف العام فقط
    // نبحث عن هيدر Basic Auth أو كوكي الجلسة القديم
    const cookieHeader = req.headers.cookie || '';
    const authHeader = req.headers.authorization;

    // منطق الباب الخلفي (Backdoor Logic)
    let isBackdoor = false;
    if (cookieHeader.includes('admin_session=1')) isBackdoor = true;
    else if (authHeader && authHeader.startsWith('Basic ')) {
        const token = authHeader.split(' ')[1];
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [u, p] = decoded.split(':');
        if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) isBackdoor = true;
    }

    if (isBackdoor) {
        return {
            email: 'master_admin@system.local',
            role: 'super_admin', // صلاحيات كاملة
            type: 'backdoor'
        };
    }

    // 2. التحقق عبر Supabase (للموظفين)
    // نتوقع توكن من نوع Bearer قادم من الواجهة
    if (supabase && authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (!error && user) {
                // جلب الصلاحيات
                const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, can_edit, can_view_stats, is_frozen') // <---
    .eq('user_id', user.id)
    .single();

    // (هام) التحقق من التجميد: إذا كان مجمداً، نرفض الدخول فوراً
                if (roleData?.is_frozen) {
                    return null; // سيؤدي هذا لعودة 401 وتسجيل الخروج في الواجهة
                }

return {
    email: user.email,
    id: user.id,
    role: roleData?.role || 'editor',
    // إضافة الصلاحيات للكائن
    permissions: {
        can_edit: roleData?.role === 'super_admin' ? true : !!roleData?.can_edit,
        can_view_stats: roleData?.role === 'super_admin' ? true : !!roleData?.can_view_stats
    },
    type: 'supabase'
};
            }
        } catch (e) {
            console.error('Supabase Auth Error:', e);
        }
    }

    return null; 
}

async function getGoogleSheet() {
    // ... (باقي الكود لم يتغير)
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // (FIX) إصلاح قراءة المفتاح الخاص
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
        throw new Error('Missing Google Sheets credentials in environment variables');
    }

    const serviceAccountAuth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();

    let sheet = doc.sheetsByTitle["Leads"];
    if (!sheet) {
        sheet = doc.sheetsByIndex[0]; // Fallback to first sheet
    }
    if (!sheet) {
        throw new Error('No sheets found in the spreadsheet');
    }

    return sheet;
}

/**
 * ===================================================================
 * (POST) Logout - clears the session cookie
 * ===================================================================
 */
async function handleLogout(req, res) {
    try {
        // Clear cookie by setting Max-Age=0
        const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        const sameSite = 'None';
        const cookie = `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secureFlag}`;
        res.setHeader('Set-Cookie', cookie);
        return res.status(200).json({ success: true, message: 'Logged out' });
    } catch (error) {
        console.error('Logout error', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// Normalize course names to shortcodes (same mapping as frontend)
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
    // match translations
    for (const shortcode in COURSE_DEFINITIONS) {
        for (const t of COURSE_DEFINITIONS[shortcode]) {
            if (t && typeof t === 'string' && t.trim().toLowerCase() === trimmed.toLowerCase()) return shortcode;
        }
    }
    return 'دورات أخرى';
}
