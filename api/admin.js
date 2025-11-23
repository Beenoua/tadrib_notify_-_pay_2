import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

// Simple authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

// إعدادات Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    } catch (error) {
        console.warn('Supabase initialization failed:', error.message);
    }
}

// ===================================================================
// Helper Functions
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
// User Management Handlers
// ===================================================================

async function handleGetUsers(res) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role, is_frozen, can_edit, can_view_stats');

    const rolesMap = {};
    if (rolesData) rolesData.forEach(r => rolesMap[r.user_id] = r);

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

async function handleUpdateUser(req, res) {
    const { userId, role, can_edit, can_view_stats, is_frozen } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const { error } = await supabase
        .from('user_roles')
        .update({ 
            role: role,
            can_edit: role === 'super_admin' ? true : can_edit,
            can_view_stats: role === 'super_admin' ? true : can_view_stats,
            is_frozen: is_frozen
        })
        .eq('user_id', userId);

    if (error) throw error;
    return res.status(200).json({ success: true, message: 'User updated successfully' });
}

async function handleAddUser(req, res) {
    const { email, password, role, can_edit, can_view_stats } = req.body;

    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email: email, password: password, email_confirm: true
    });

    if (createError) throw createError;

    if (userData.user) {
        const { error: roleError } = await supabase
            .from('user_roles')
            .insert([{ 
                user_id: userData.user.id, 
                role: role, 
                email: email,
                can_edit: role === 'super_admin' ? true : (can_edit || false),
                can_view_stats: role === 'super_admin' ? true : (can_view_stats || false)
            }]);        
        if (roleError) {
            await supabase.auth.admin.deleteUser(userData.user.id);
            throw roleError;
        }
    }
    return res.status(201).json({ success: true, message: 'User created successfully' });
}

async function handleDeleteUser(req, res) {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;

    return res.status(200).json({ success: true, message: 'User deleted' });
}

async function handleChangePassword(req, res, currentUser) {
    const { newPassword, userId } = req.body;
    const targetId = (currentUser.role === 'super_admin' && userId) ? userId : currentUser.id;

    const { error } = await supabase.auth.admin.updateUserById(targetId, { password: newPassword });

    if (error) throw error;
    return res.status(200).json({ success: true, message: 'Password updated' });
}

// ===================================================================
// Main Handler
// ===================================================================
export default async function handler(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    try {
        const { action } = req.query || {}; 

        if (action === 'login' || (req.method === 'POST' && req.body?.username && !req.headers.authorization)) {
            return handleLogin(req, res);
        }
        if (action === 'logout' || req.url.includes('/logout')) {
            return handleLogout(req, res);
        }

        const user = await authenticateUser(req, res);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized access' });
        }

        if (['get_users', 'add_user', 'delete_user', 'change_password', 'update_user'].includes(action)) {            
            if (user.role !== 'super_admin' && action !== 'change_password') {
                 return res.status(403).json({ error: 'Forbidden: Admins only' });
            }
            if (action === 'get_users') return handleGetUsers(res);
            if (action === 'add_user') return handleAddUser(req, res);
            if (action === 'delete_user') return handleDeleteUser(req, res);
            if (action === 'change_password') return handleChangePassword(req, res, user);
            if (action === 'update_user') return handleUpdateUser(req, res);
        }

        if (req.method === 'GET') return handleGet(req, res, user);
        else if (req.method === 'POST') return handlePost(req, res, user);
        else if (req.method === 'PUT') {
            if (user.role !== 'super_admin' && !user.permissions?.can_edit) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل البيانات' });
            }
            return handlePut(req, res, user);
        } else if (req.method === 'DELETE') {
            if (user.role !== 'super_admin') { 
                 return res.status(403).json({ error: 'الحذف مقتصر على المدير العام' });
            }
            return handleDelete(req, res, user);
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Handler Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}

async function handleLogin(req, res) {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: 'Required fields missing' });

        // Backdoor
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const maxAge = 24 * 60 * 60;
            const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            res.setHeader('Set-Cookie', `admin_session=1; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=None${secureFlag}`);
            return res.status(200).json({ success: true, role: 'super_admin', type: 'backdoor' });
        }

        // Supabase
        if (supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({ email: username, password: password });
            if (!error && data.user) {
                const { data: roleData } = await supabase
                    .from('user_roles')
                    .select('role, can_edit, can_view_stats, is_frozen')
                    .eq('user_id', data.user.id)
                    .single();
                
                if (roleData?.is_frozen) return res.status(401).json({ error: 'الحساب مجمد' });

                return res.status(200).json({
                    success: true,
                    token: data.session.access_token,
                    role: roleData?.role || 'editor',
                    permissions: {
                        can_edit: roleData?.role === 'super_admin' ? true : (roleData?.can_edit ?? false),
                        can_view_stats: roleData?.role === 'super_admin' ? true : (roleData?.can_view_stats ?? false)
                    },
                    type: 'supabase'
                });
            }
        }
        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

async function handleGet(req, res, user) {
    try {
        const { searchTerm, statusFilter, paymentFilter, courseFilter, dateFilter, startDate, endDate } = req.query;

        const sheet = await getGoogleSheet();
        const rows = await sheet.getRows();

        // (إصلاح 1: استخدام let بدلاً من const)
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
            utm_content: row.get('utm_content') || '',
            lastUpdatedBy: row.get('Last Updated By') || '',
            parsedDate: parseDate(row.get('Timestamp') || ''),
            normalizedCourse: normalizeCourseName(row.get('Selected Course') || '')
        }));

        // الفلتر الأمني
        if (user.role !== 'super_admin') {
            data = data.filter(item => item.status.toLowerCase() !== 'paid');
        }

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
            // (إصلاح 2: إرسال الصلاحيات المحدثة مع كل طلب)
            currentUser: { 
                email: user.email, 
                role: user.role,
                permissions: user.permissions // <--- هذا هو المفتاح للتزامن الفوري
            } 
        });

    } catch (error) {
        console.error('Admin GET API Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// ... (handlePost, handlePut, handleDelete, authenticateUser, getGoogleSheet, handleLogout, parseDate, normalizeCourseName - بقية الدوال تبقى كما هي أو كما صححناها سابقاً)
async function handlePost(req, res, user) {
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
            'Last Updated By': user.email 
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

        if (!id) return res.status(400).json({ error: 'ID required' });

        const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);
        if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });

        const rowToUpdate = rows[rowIndex];
        const currentStatus = (rowToUpdate.get('Payment Status') || '').toLowerCase();

        if (user.role !== 'super_admin') {
            if (currentStatus === 'paid') return res.status(403).json({ error: 'لا تملك صلاحية تعديل المعاملات المدفوعة.' });
            if (!user.permissions?.can_edit) return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل البيانات' });
        }

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
        if (updatedItem.utm_content) rowToUpdate.set('utm_content', updatedItem.utm_content);
        rowToUpdate.set('Last Updated By', user.email);

        await rowToUpdate.save();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function handleDelete(req, res, user) {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });

        const sheet = await getGoogleSheet(); 
        const rows = await sheet.getRows();
        const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === id || row.get('Transaction ID') === id);

        if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });

        await rows[rowIndex].delete();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function authenticateUser(req, res) {
    const cookieHeader = req.headers.cookie || '';
    const authHeader = req.headers.authorization;

    // Backdoor
    if (cookieHeader.includes('admin_session=1')) return { email: 'master_admin@system.local', role: 'super_admin', type: 'backdoor' };
    if (authHeader && authHeader.startsWith('Basic ')) {
        const token = authHeader.split(' ')[1];
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [u, p] = decoded.split(':');
        if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) return { email: 'master_admin@system.local', role: 'super_admin', type: 'backdoor' };
    }

    // Supabase
    if (supabase && authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (!error && user) {
                const { data: roleData } = await supabase
                    .from('user_roles')
                    .select('role, can_edit, can_view_stats, is_frozen')
                    .eq('user_id', user.id)
                    .single();

                if (roleData?.is_frozen) return null; // Frozen -> 401

                return {
                    email: user.email,
                    id: user.id,
                    role: roleData?.role || 'editor',
                    permissions: {
                        can_edit: roleData?.role === 'super_admin' ? true : !!roleData?.can_edit,
                        can_view_stats: roleData?.role === 'super_admin' ? true : !!roleData?.can_view_stats
                    },
                    type: 'supabase'
                };
            }
        } catch (e) { console.error('Supabase Auth Error:', e); }
    }
    return null; 
}

async function getGoogleSheet() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!spreadsheetId || !serviceAccountEmail || !privateKey) throw new Error('Missing Google Sheets credentials');

    const serviceAccountAuth = new JWT({ email: serviceAccountEmail, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();
    return doc.sheetsByTitle["Leads"] || doc.sheetsByIndex[0];
}

async function handleLogout(req, res) {
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=None${secureFlag}`);
    return res.status(200).json({ success: true });
}

function normalizeCourseName(raw) {
    if (!raw) return 'دورات أخرى';
    const trimmed = String(raw).trim().toLowerCase();
    if (trimmed.includes('pmp')) return 'PMP';
    if (trimmed.includes('planning')) return 'Planning';
    if (trimmed.includes('qse')) return 'QSE';
    if (trimmed.includes('softskills') || trimmed.includes('soft skills')) return 'Soft Skills';
    return 'دورات أخرى';
}
