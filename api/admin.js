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
// 1. Strict Context Factory (مصنع السياق الصارم)
// ===================================================================

/**
 * هذه الدالة هي "نقطة التفتيش". تحدد نوع المستخدم وتعطيه الأداة المناسبة فقط.
 * تمنع خلط الصلاحيات نهائياً.
 */
async function getRequestContext(req) {
    const authHeader = req.headers.authorization || '';
    const cookieHeader = req.headers.cookie || '';

    // --- المسار الأول: Backdoor (Super Admin) ---
    // الشروط: وجود الكوكيز الخاص بالأدمن أو Basic Auth صحيح
    const isBackdoorCookie = cookieHeader.includes('admin_session=1');
    let isBackdoorBasic = false;
    
    if (authHeader.startsWith('Basic ')) {
        const creds = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        if (creds[0] === process.env.ADMIN_USERNAME && creds[1] === process.env.ADMIN_PASSWORD) {
            isBackdoorBasic = true;
        }
    }

    if (isBackdoorCookie || isBackdoorBasic) {
        // ✅ إنشاء عميل "Admin" معزول بصلاحيات Service Role
        // هذا العميل يتجاوز كل سياسات RLS (God Mode)
        const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        
        return {
            type: 'backdoor',
            role: 'super_admin',
            email: 'master_admin@system.local',
            // هذا العميل يملك صلاحية تعديل أي شيء
            dbClient: adminClient, 
            permissions: { can_edit: true, can_view_stats: true }
        };
    }

    // --- المسار الثاني: Supabase User (Staff) ---
    // الشروط: وجود Bearer Token
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        
        // ✅ إنشاء عميل "User" مقيد بالتوكن
        // هذا العميل يحترم سياسات RLS ولا يمكنه تجاوزها
        const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // التحقق من صحة التوكن
        const { data: { user }, error } = await userClient.auth.getUser();

        if (error || !user) return null; // توكن غير صالح

        // جلب الصلاحيات من جدول user_roles
        // نستخدم userClient هنا، لذا يجب أن تسمح سياسات RLS بالقراءة (وهذا ما فعلناه سابقاً)
        const { data: roleData } = await userClient
            .from('user_roles')
            .select('role, can_edit, can_view_stats, is_frozen')
            .eq('user_id', user.id)
            .single();

        if (roleData?.is_frozen) return null; // حساب مجمد

        // تحديد الصلاحيات بناءً على الدور
        const isSuper = roleData?.role === 'super_admin';

        return {
            type: 'supabase',
            role: roleData?.role || 'editor',
            email: user.email,
            id: user.id,
            // هذا العميل مقيد بصلاحيات الموظف
            dbClient: userClient, 
            // إذا كان سوبر أدمن، نعطيه Admin Client لعمليات التعديل الحساسة، وإلا نعطيه User Client
            // هذه نقطة ذكية: الموظف العادي يستخدم عميله، المدير يستخدم عميل الخدمة عند الحاجة
            permissions: {
                can_edit: isSuper ? true : !!roleData?.can_edit,
                can_view_stats: isSuper ? true : !!roleData?.can_view_stats
            },
            // نحتفظ بمرجع للـ Service Client للحالات الطارئة للمدراء فقط
            systemClient: isSuper ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null
        };
    }

    return null; // لا يوجد دخول
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
// User Management Handlers (CORRECTED WITH CONTEXT)
// ===================================================================

// جلب قائمة المستخدمين
async function handleGetUsers(res, context) { // <--- أضفنا context
    // نستخدم العميل المناسب من السياق
    const db = context.type === 'backdoor' ? context.dbClient : context.systemClient;
    if (!db) return res.status(403).json({ error: 'System Access Required' });

    // 1. جلب المستخدمين من Auth
    const { data: { users }, error } = await db.auth.admin.listUsers();
    if (error) throw error;

    // 2. جلب تفاصيل الأدوار
    const { data: rolesData } = await db
        .from('user_roles')
        .select('user_id, role, is_frozen, can_edit, can_view_stats');

    const rolesMap = {};
    if (rolesData) {
        rolesData.forEach(r => rolesMap[r.user_id] = r);
    }

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

// تحديث بيانات الموظف
async function handleUpdateUser(req, res, context) { // <--- أضفنا context
    const { userId, role, can_edit, can_view_stats, is_frozen } = req.body;
    
    // استخدام العميل "Service Role" الموجود في السياق
    const db = context.type === 'backdoor' ? context.dbClient : context.systemClient;
    if (!db) return res.status(403).json({ error: 'System Access Required' });

    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    try {
        // جلب البريد لضمان صحة البيانات
        const { data: { user }, error: fetchError } = await db.auth.admin.getUserById(userId);
        if (fetchError || !user) return res.status(404).json({ error: 'User not found in Auth' });

        // التحديث باستخدام العميل الآمن
        const { data, error } = await db
            .from('user_roles')
            .upsert({ 
                user_id: userId,
                email: user.email,
                role: role,
                can_edit: role === 'super_admin' ? true : can_edit,
                can_view_stats: role === 'super_admin' ? true : can_view_stats,
                is_frozen: is_frozen
            }, { onConflict: 'user_id' })
            .select();

        if (error) throw error;

        return res.status(200).json({ success: true, message: 'User updated successfully', updatedData: data });

    } catch (error) {
        console.error('Update Role Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// إضافة موظف جديد
async function handleAddUser(req, res, context) { // <--- أضفنا context
    const { email, password, role, can_edit, can_view_stats } = req.body;
    
    const db = context.type === 'backdoor' ? context.dbClient : context.systemClient;
    if (!db) return res.status(403).json({ error: 'System Access Required' });

    try {
        const { data: userData, error: createError } = await db.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true
        });

        if (createError) throw createError;

        if (userData.user) {
            const { error: roleError } = await db
                .from('user_roles')
                .upsert([{ 
                    user_id: userData.user.id, 
                    role: role, 
                    email: email,
                    can_edit: role === 'super_admin' ? true : (can_edit || false),
                    can_view_stats: role === 'super_admin' ? true : (can_view_stats || false)
                }], { onConflict: 'user_id' }); // ضمان عدم التكرار

            if (roleError) {
                // تراجع: حذف المستخدم إذا فشل تعيين الدور
                await db.auth.admin.deleteUser(userData.user.id);
                throw roleError;
            }
        }
        return res.status(201).json({ success: true, message: 'User created successfully' });

    } catch (error) {
        console.error('Add User Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// حذف موظف
async function handleDeleteUser(req, res, context) { // <--- أضفنا context
    const { userId } = req.body;
    
    const db = context.type === 'backdoor' ? context.dbClient : context.systemClient;
    if (!db) return res.status(403).json({ error: 'System Access Required' });

    if (!userId) return res.status(400).json({ error: 'User ID required' });

    // 1. حذف من user_roles أولاً (اختياري لأن Auth يحذفه تلقائياً لكن للأمان)
    await db.from('user_roles').delete().eq('user_id', userId);

    // 2. حذف من Auth
    const { error } = await db.auth.admin.deleteUser(userId);
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
        const { action } = req.query || {};

        // 1. مسارات عامة (Login/Logout) لا تحتاج سياق
        if (action === 'login' || req.body?.username) return handleLogin(req, res);
        if (action === 'logout') return handleLogout(req, res);

        // 2. الحصول على "السياق الصارم"
        const context = await getRequestContext(req);

        if (!context) {
            return res.status(401).json({ error: 'Unauthorized Access' });
        }

        // ============================================================
        // 3. توجيه عمليات إدارة المستخدمين (User Management)
        // ============================================================
        const userMgmtActions = ['get_users', 'add_user', 'delete_user', 'change_password', 'update_user'];
        
        if (userMgmtActions.includes(action)) {
            
            // تحقق صارم: هل يسمح السياق بذلك؟
            // الباب الخلفي دائماً مسموح، Supabase فقط إذا كان Super Admin
            const isAllowed = context.type === 'backdoor' || context.role === 'super_admin';
            
            // استثناء: تغيير كلمة المرور مسموح للنفس
            if (!isAllowed && action !== 'change_password') {
                return res.status(403).json({ error: 'Forbidden: Admins Only' });
            }

            // توجيه الطلب للدالة المناسبة مع تمرير الـ context
            if (action === 'get_users') return handleGetUsers(res, context);
            if (action === 'add_user') return handleAddUser(req, res, context);
            if (action === 'delete_user') return handleDeleteUser(req, res, context);
            if (action === 'update_user') return handleUpdateUser(req, res, context);
            
            // التعامل مع تغيير كلمة المرور (حالة خاصة تحتاج user object)
            // سنتركها تمر للأسفل قليلاً لاستخدام authenticateUser القديم أو نعالجها هنا
            // للأمان والسرعة، سنستخدم authenticateUser في الخطوة التالية لهذا الإجراء
        }

        // +++++ [إضافة جديدة: مسار إضافة المصاريف] +++++
        if (action === 'add_spend' && req.method === 'POST') {
            // التحقق: هل المستخدم لديه صلاحية؟ (سوبر أدمن أو محرر لديه صلاحية التعديل)
            const canAddSpend = context.role === 'super_admin' || context.permissions.can_edit;
            
            if (!canAddSpend) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة مصاريف تسويقية' });
            }
            return handleAddSpend(req, res); // سنقوم بإنشاء هذه الدالة في الخطوة 3
        }
        // ++++++++++++++++++++++++++++++++++++++++++++++

        // 4. Authentication Check (Legacy wrapper for older functions)
        // نحتاج هذا الكائن للدوال التي لم نقم بتحديثها بالكامل لتقبل context
        const user = await authenticateUser(req, res);
        
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized access: Invalid token or credentials' });
        }
        
        // تكملة التعامل مع تغيير كلمة المرور
        if (action === 'change_password') {
             return handleChangePassword(req, res, user);
        }

        // 5. Lead Management Routes (CRUD for Google Sheets)
        // هذه المسارات متاحة للجميع (Admins & Editors) مع قيود داخلية
        if (req.method === 'GET') {
            return handleGet(req, res, user); // <--- هذا ما كان محظوراً سابقاً والآن أصبح متاحاً
        } else if (req.method === 'POST') {
            return handlePost(req, res, user);
        } else if (req.method === 'PUT') {
            // التحقق من صلاحية التعديل
            if (user.role !== 'super_admin' && !user.permissions?.can_edit) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل البيانات' });
            }
            return handlePut(req, res, user);
        } else if (req.method === 'DELETE') {
            // التحقق من صلاحية الحذف
            if (user.role !== 'super_admin') {
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

// +++++ [دالة جديدة كلياً] +++++
async function handleAddSpend(req, res) {
    try {
        const { date, campaign, source, spend, impressions, clicks } = req.body;

        // 1. التحقق من البيانات المطلوبة
        if (!date || !campaign || !spend) {
            return res.status(400).json({ error: 'البيانات ناقصة: التاريخ، الحملة، والمبلغ مطلوبين' });
        }

        const doc = await getGoogleDoc();
        const sheet = doc.sheetsByTitle["Marketing_Spend"];

        // 2. التحقق من وجود الورقة
        if (!sheet) {
            return res.status(500).json({ error: 'ورقة Marketing_Spend غير موجودة في ملف جوجل شيت' });
        }

        // 3. إضافة الصف
        await sheet.addRow({
            'Date': date,
            'Campaign': campaign,
            'Source': source || 'Manual', // افتراضي
            'Ad Spend': spend,
            'Impressions': impressions || 0,
            'Clicks': clicks || 0
        });

        return res.status(200).json({ success: true, message: 'تم إضافة المصاريف بنجاح' });

    } catch (error) {
        console.error('Add Spend Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
// ++++++++++++++++++++++++++++++

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
// جلب البيانات (Leads + Marketing Spend) - محدثة
async function handleGet(req, res, context) {
    try {
        const { startDate, endDate, status, course, paymentMethod } = req.query;
        
        const doc = await getGoogleDoc();
        
        // 1. محاولة ذكية لجلب ورقة المبيعات (Leads)
        // نحاول البحث بالاسم الدقيق، وإذا فشل نبحث عن أي ورقة تحتوي على كلمة Leads
        let leadsSheet = doc.sheetsByTitle["Leads"];
        
        if (!leadsSheet) {
            // بحث مرن في حال وجود مسافات زائدة في الاسم
            leadsSheet = doc.sheetsByIndex.find(s => s.title.includes("Lead"));
        }
        
        if (!leadsSheet) {
            // الملاذ الأخير: الورقة الأولى، لكن نطبع تحذيراً
            console.warn('[Warning] Could not find "Leads" sheet. Using first sheet.');
            leadsSheet = doc.sheetsByIndex[0];
        }

        console.log(`[Debug] Reading Leads from sheet: "${leadsSheet.title}"`);
        await leadsSheet.loadHeaderRow(); 
        const leadsRows = await leadsSheet.getRows();
        console.log(`[Debug] Found ${leadsRows.length} lead rows.`);

        // 2. جلب ورقة المصاريف
        let spendSheet = doc.sheetsByTitle["Marketing_Spend"];
        let spendRows = [];
        if (spendSheet) {
            try {
                await spendSheet.loadHeaderRow();
                spendRows = await spendSheet.getRows();
            } catch (e) {
                console.log('[Info] Marketing_Spend sheet exists but might be empty.');
            }
        }

        // تحضير التواريخ
        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            const parts = dateStr.split(' ')[0].split('/'); 
            if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            return new Date(dateStr);
        };

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        // فلترة Leads
        let filteredLeads = leadsRows.map(row => {
            const rowData = row.toObject();
            rowData.rowIndex = row.rowNumber;
            return rowData;
        }).filter(row => {
            const rowDate = parseDate(row['Timestamp']);
            if (start && rowDate && rowDate < start) return false;
            if (end && rowDate && rowDate > end) return false;
            if (status && row['Payment Status'] !== status) return false;
            if (course && row['Selected Course'] !== course) return false;
            if (paymentMethod && row['Payment Method'] !== paymentMethod) return false;
            return true;
        });

        // فلترة Spend
        let filteredSpend = spendRows.map(row => row.toObject()).filter(row => {
            const rowDate = parseDate(row['Date']); 
            if (start && rowDate && rowDate < start) return false;
            if (end && rowDate && rowDate > end) return false;
            return true;
        });

        // التحقق من الصلاحيات (مع حماية ضد الأخطاء)
        // إذا كان context غير موجود (اتصال قديم)، نفترض أنه أدمن مؤقتاً لتفادي حجب البيانات عنك
        const role = context?.role || 'super_admin'; 
        const perms = context?.permissions || { can_view_stats: true };

        const isSuperAdmin = role === 'super_admin';
        const canViewStats = perms.can_view_stats;

        if (!isSuperAdmin && !canViewStats) {
            filteredLeads = filteredLeads.map(item => ({ 
                ...item, Amount: '***', 'Transaction ID': '***' 
            }));
        }

        res.status(200).json({
            success: true,
            data: filteredLeads,
            marketingSpend: filteredSpend,
            isFiltered: !!(startDate || endDate || status || course),
            currentUser: { 
                email: context?.email || 'admin', 
                role: role,
                permissions: perms,
                is_frozen: false 
            } 
        });

    } catch (error) {
        console.error('Get Data Error:', error);
        res.status(500).json({ error: error.message });
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
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // التأكد من تنسيق المفتاح الخاص بشكل صحيح
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
        throw new Error('Configuration Error: Missing Google Sheets credentials.');
    }

    // إعداد الاتصال
    const serviceAccountAuth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    
    // محاولة تحميل معلومات الملف
    await doc.loadInfo();

    // [LOG] معلومات الملف الأساسية
    console.log(`[GoogleSheets] Connected to: "${doc.title}"`);

    // محاولة الوصول للورقة المحددة
    let sheet = doc.sheetsByTitle["Leads"];

    if (sheet) {
        console.log(`[GoogleSheets] ✅ Using target sheet: "Leads"`);
    } else {
        // الخطة البديلة
        sheet = doc.sheetsByIndex[0];
        console.warn(`[GoogleSheets] ⚠️ "Leads" sheet not found. Fallback to index 0: "${sheet.title}"`);
    }

    // التحقق من صحة العناوين (Headers) لتجنب الخطأ الشهير 500
    try {
        await sheet.loadHeaderRow();
        console.log(`[GoogleSheets] Sheet Stats: ${sheet.rowCount} rows, ${sheet.columnCount} columns.`);
    } catch (e) {
        console.error(`[GoogleSheets] ❌ CRITICAL: Could not load header row. The sheet "${sheet.title}" might be empty!`);
        // لا نرمي الخطأ هنا، نترك المكتبة تتصرف، لكننا سجلنا التحذير
    }

    return sheet;
}

// +++++ [دالة مساعدة جديدة مطلوبة] +++++
// هذه الدالة تتصل بملف جوجل شيت كاملاً لتمكننا من اختيار الورقة المناسبة (Leads أو Marketing_Spend)
async function getGoogleDoc() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
        throw new Error('Configuration Error: Missing Google Sheets credentials.');
    }

    const serviceAccountAuth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    
    // تحميل معلومات الملف (أسماء الأوراق، إلخ)
    await doc.loadInfo();
    console.log(`[GoogleSheets] Connected to doc: "${doc.title}"`);
    
    return doc;
}
// ++++++++++++++++++++++++++++++++++++++

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
