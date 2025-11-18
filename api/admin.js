import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
// ملاحظة: تأكد من أن ملف utils.js موجود إذا كنت تستخدمه
// import { validateRequired, validateEmail } from './utils.js'; 

// Simple authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

/**
 * ===================================================================
 * Main Handler (Routes requests)
 * ===================================================================
 */
export default async function handler(req, res) {
    // CORS headers
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
        res.status(405).json({ error: 'Method not allowed' });
    }
}

/**
 * ===================================================================
 * Helper Functions (Authentication & Sheet Connection)
 * ===================================================================
 */

/**
 * (NEW) Function to authenticate requests
 */
async function authenticate(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        res.status(401).json({ error: 'Authentication required' });
        return false;
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Invalid credentials' });
        return false;
    }
    return true; // Authentication successful
}

/**
 * (NEW) Function to connect to Google Sheets
 */
async function getGoogleSheet() {
    // Validate environment variables
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');

    if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
        console.error('Missing Google Sheets environment variables');
        throw new Error('Server configuration error');
    }

    // Initialize Google Sheets
    const serviceAccountAuth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();

    // Try to get the "Leads" sheet first, fallback to first sheet
    let sheet;
    try {
        sheet = doc.sheetsByTitle["Leads"];
    } catch (e) {
        sheet = doc.sheetsByIndex[0]; // Fallback to first sheet
    }

    if (!sheet) {
        throw new Error('No sheets found in the spreadsheet');
    }
    return sheet;
}


/**
 * ===================================================================
 * HTTP Method Handlers
 * ===================================================================
 */

/**
 * (GET) Fetches all data and statistics
 */
async function handleGet(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate
        const sheet = await getGoogleSheet(); // Connect to sheet

        const rows = await sheet.getRows();

        // Process and clean the data
        const data = rows.map(row => {
            let cleanStatus = row.get('Payment Status');
            if (!cleanStatus || typeof cleanStatus !== 'string' || cleanStatus.trim() === '' || cleanStatus.trim().toLowerCase() === 'undefined') {
                cleanStatus = 'pending';
            }

            return {
                timestamp: row.get('Timestamp') || '',
                status: cleanStatus.trim().toLowerCase(),
                transactionId: row.get('Transaction ID') || '',
                amount: parseFloat(row.get('Amount')) || 0,
                currency: row.get('Currency') || 'MAD',
                customerName: row.get('Full Name') || '',
                customerEmail: row.get('Email') || '',
                customerPhone: row.get('Phone Number') || '',
                course: row.get('Selected Course') || '',
                qualification: row.get('Qualification') || '',
                experience: row.get('Experience') || '',
                paymentMethod: row.get('Payment Method') || '',
                language: row.get('Lang') || '',
                finalAmount: parseFloat(row.get('Amount')) || 0,
                cashplusCode: row.get('CashPlus Code') || '',
                last4: row.get('Last4Digits') || '',
                inquiryId: row.get('Inquiry ID') || '',
                utm_source: row.get('utm_source') || '',
                utm_medium: row.get('utm_medium') || '',
                utm_campaign: row.get('utm_campaign') || '',
                utm_term: row.get('utm_term') || '',
                utm_content: row.get('utm_content') || ''
            };
        });

       // (تعديل) استبدال حاسبة الإحصائيات البسيطة بالحاسبة التفصيلية
        // Calculate statistics (REPLACED BLOCK)
        const stats = {
            totalPayments: data.length, paidPayments: 0, pendingPayments: 0, failedPayments: 0, canceledPayments: 0,
            cashplusPayments: 0, cardPayments: 0, arabicUsers: 0, frenchUsers: 0, englishUsers: 0,
            netRevenue: 0, pendingRevenue: 0, failedRevenue: 0, canceledRevenue: 0,
            paid_cashplus: 0, paid_card: 0, pending_cashplus: 0, pending_card: 0,
            failed_cashplus: 0, failed_card: 0, canceled_cashplus: 0, canceled_card: 0,
            net_cashplus_revenue: 0, net_card_revenue: 0,
        };

        if (data && data.length > 0) {
            for (const item of data) {
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
        }
        // (نهاية التعديل)

        res.status(200).json({
            success: true,
            data: data,
            statistics: stats,
            totalRecords: data.length
        });

    } catch (error) {
        console.error('Admin GET API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
}

/**
 * (POST) Creates a new record
 */
async function handlePost(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate
        const sheet = await getGoogleSheet(); // Connect to sheet
        
        const newData = req.body;

        // Generate required IDs and timestamp
        const timestamp = new Date().toLocaleString('fr-CA'); 
        const inquiryId = `MANUAL-${Date.now()}`;

        // Map data to sheet headers
        const newRow = {
            'Timestamp': timestamp,
            'Inquiry ID': inquiryId,
            'Payment Status': newData.status || 'pending',
            'Full Name': newData.customerName,
            'Email': newData.customerEmail,
            'Phone Number': newData.customerPhone,
            'Selected Course': newData.course,
            'Amount': newData.finalAmount.toString(),
            'Payment Method': newData.paymentMethod,
            'Lang': newData.language,
            'Qualification': newData.qualification,
            'Experience': newData.experience,
            'utm_source': newData.utm_source || 'manual',
        };

        await sheet.addRow(newRow);

        res.status(201).json({
            success: true,
            message: 'Record created successfully',
            inquiryId: inquiryId
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
 * (PUT) Updates an existing record
 */
async function handlePut(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate

        // --- START: (FIX) إضافة الكود المفقود ---
        const { inquiryId, ...updateData } = req.body;

        if (!inquiryId) {
            return res.status(400).json({ error: 'Inquiry ID is required' });
        }
        // --- END: (FIX) ---
        
        const sheet = await getGoogleSheet(); // Connect to sheet
        const rows = await sheet.getRows();

        // Find the row with matching inquiryId
        const rowIndex = rows.findIndex(row => row.get('Inquiry ID') === inquiryId);

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }

        const row = rows[rowIndex];

        // Update the row with new data
        if (updateData.customerName !== undefined) row.set('Full Name', updateData.customerName);
        if (updateData.customerEmail !== undefined) row.set('Email', updateData.customerEmail);
        if (updateData.customerPhone !== undefined) row.set('Phone Number', updateData.customerPhone);
        if (updateData.course !== undefined) row.set('Selected Course', updateData.course);
        if (updateData.status !== undefined) row.set('Payment Status', updateData.status);
        if (updateData.paymentMethod !== undefined) row.set('Payment Method', updateData.paymentMethod);
        if (updateData.finalAmount !== undefined) row.set('Amount', updateData.finalAmount.toString());
        if (updateData.language !== undefined) row.set('Lang', updateData.language);
        if (updateData.qualification !== undefined) row.set('Qualification', updateData.qualification);
        if (updateData.experience !== undefined) row.set('Experience', updateData.experience);
        if (updateData.utm_source !== undefined) row.set('utm_source', updateData.utm_source);

        await row.save();

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
 * (DELETE) Deletes an existing record
 */
async function handleDelete(req, res) {
    try {
        if (!await authenticate(req, res)) return; // Authenticate

        // --- START: (FIX) إضافة الكود المفقود ---
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        // --- END: (FIX) ---

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
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
}





