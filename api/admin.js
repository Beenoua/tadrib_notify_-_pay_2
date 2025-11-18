import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
// ملاحظة: تأكد من أن ملف utils.js موجود إذا كنت تستخدمه
// import { validateRequired, validateEmail } from './utils.js'; 

// Simple authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

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


/**
 * ===================================================================
 * Main Handler (Routes requests)
 * ===================================================================
 */
export default async function handler(req, res) {
    // ... (CORS headers - لم يتغير)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Handle different HTTP methods
    if (req.method === 'GET') {
        return handleGet(req, res);
    } else if (req.method === 'POST') {
        return handlePost(req, res);
    } else if (req.method === 'PUT') {
        return handlePut(req, res);
    } else if (req.method === 'DELETE') {
        return handleDelete(req, res);
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}

/**
 * ===================================================================
 * (GET) Fetches records and statistics (MODIFIED)
 * ===================================================================
 */
async function handleGet(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate

        // (NEW) قراءة الفلاتر من الرابط
        const {
            searchTerm,
            statusFilter,
            paymentFilter,
            dateFilter,
            startDate,
            endDate
        } = req.query;

        const sheet = await getGoogleSheet(); // Connect to sheet
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
            // (NEW) إضافة تاريخ مهيأ للفلترة
            parsedDate: parseDate(row.get('Timestamp') || '') 
        }));
        
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
                const matchesDate = checkDateFilter(item, dateFilter, startDate, endDate);
                
                return matchesSearch && matchesStatus && matchesPayment && matchesDate;
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
            isFiltered: isFiltered
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
async function handlePost(req, res) {
     try {
        if (!await authenticate(req, res)) return; // Authenticate
// ... (باقي الكود لم يتغير)
        const sheet = await getGoogleSheet(); // Connect to sheet
        
        // (تعديل) إضافة بيانات الطلب إلى Google Sheet
        const newItem = req.body;
        
        await sheet.addRow({
            'Timestamp': new Date().toISOString(),
            'Inquiry ID': `MANUAL-${Date.now()}`,
            'Full Name': newItem.customerName,
            'Email': newItem.customerEmail,
            'Phone Number': newItem.customerPhone,
            'Selected Course': newItem.course,
            'Qualification': newItem.qualification,
            'Experience': newItem.experience,
            'Payment Status': newItem.status,
            'Payment Method': newItem.paymentMethod,
            'Amount': newItem.finalAmount,
            'Lang': newItem.language,
            'utm_source': newItem.utm_source || 'manual'
            // أضف أي حقول أخرى هنا
        });

        res.status(201).json({
            success: true,
            message: 'Record created successfully'
        });

    } catch (error) {
        console.error('Admin POST API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
}


/**
 * ===================================================================
 * (PUT) Updates an existing record (لم يتغير)
 * ===================================================================
 */
async function handlePut(req, res) {
     try {
        if (!await authenticate(req, res)) return; // Authenticate
// ... (باقي الكود لم يتغير)
        const sheet = await getGoogleSheet(); // Connect to sheet
        const rows = await sheet.getRows();
        
        const updatedItem = req.body;
        const id = updatedItem.inquiryId || updatedItem.transactionId;

        if (!id) {
            return res.status(400).json({ error: 'ID is required for update' });
        }

        // Find the row with matching id
        const rowIndex = rows.findIndex(row =>
            row.get('Inquiry ID') === id || row.get('Transaction ID') === id
        );

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Update the row fields
        const rowToUpdate = rows[rowIndex];
        rowToUpdate.set('Full Name', updatedItem.customerName);
        rowToUpdate.set('Email', updatedItem.customerEmail);
        rowToUpdate.set('Phone Number', updatedItem.customerPhone);
        rowToUpdate.set('Selected Course', updatedItem.course);
        rowToUpdate.set('Qualification', updatedItem.qualification);
        rowToUpdate.set('Experience', updatedItem.experience);
        rowToUpdate.set('Payment Status', updatedItem.status);
        rowToUpdate.set('Payment Method', updatedItem.paymentMethod);
        rowToUpdate.set('Amount', updatedItem.finalAmount);
        rowToUpdate.set('Lang', updatedItem.language);
        rowToUpdate.set('utm_source', updatedItem.utm_source);
        
        await rowToUpdate.save(); // Save changes

        res.status(200).json({
            success: true,
            message: 'Record updated successfully'
        });

    } catch (error) {
        console.error('Admin PUT API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
}

/**
 * ===================================================================
 * (DELETE) Deletes an existing record (لم يتغير)
 * ===================================================================
 */
async function handleDelete(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate
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
 * Helper Functions (Authentication & Google Sheet) (لم يتغير)
 * ===================================================================
 */
async function authenticate(req, res) {
// ... (باقي الكود لم يتغير)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ error: 'Authentication required' });
        return false;
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = atob(token);
    } catch (e) {
        res.status(401).json({ error: 'Invalid token format' });
        return false;
    }
    const [username, password] = decoded.split(':');
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return true;
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
        return false;
    }
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
