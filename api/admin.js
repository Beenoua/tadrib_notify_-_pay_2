import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { validateRequired, validateEmail } from './utils.js';

// Simple authentication (can be enhanced with JWT or database later)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Basic authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
            return res.status(401).json({ error: 'Authentication required' });
        }

        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');

        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Validate environment variables
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
            console.error('Missing Google Sheets environment variables');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Initialize Google Sheets
        const serviceAccountAuth = new JWT({
            email: serviceAccountEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByIndex[0]; // Assuming first sheet
        const rows = await sheet.getRows();

        // Process and clean the data
        const data = rows.map(row => ({
            timestamp: row.get('Timestamp') || '',
            status: row.get('Status') || '',
            transactionId: row.get('Transaction ID') || '',
            amount: parseFloat(row.get('Amount')) || 0,
            currency: row.get('Currency') || 'MAD',
            customerName: row.get('Customer Name') || '',
            customerEmail: row.get('Customer Email') || '',
            customerPhone: row.get('Customer Phone') || '',
            course: row.get('Course') || '',
            qualification: row.get('Qualification') || '',
            experience: row.get('Experience') || '',
            paymentMethod: row.get('Payment Method') || '',
            language: row.get('Language') || '',
            finalAmount: parseFloat(row.get('Final Amount')) || 0,
            cashplusCode: row.get('CashPlus Code') || '',
            inquiryId: row.get('Inquiry ID') || ''
        }));

        // Calculate statistics
        const stats = {
            totalPayments: data.length,
            totalRevenue: data.reduce((sum, item) => sum + item.finalAmount, 0),
            paidPayments: data.filter(item => item.status === 'paid').length,
            pendingPayments: data.filter(item => item.status === 'pending').length,
            failedPayments: data.filter(item => item.status === 'failed').length,
            cashplusPayments: data.filter(item => item.paymentMethod === 'cashplus').length,
            cardPayments: data.filter(item => item.paymentMethod === 'card').length,
            arabicUsers: data.filter(item => item.language === 'ar').length,
            frenchUsers: data.filter(item => item.language === 'fr').length,
            englishUsers: data.filter(item => item.language === 'en').length
        };

        res.status(200).json({
            success: true,
            data: data,
            statistics: stats,
            totalRecords: data.length
        });

    } catch (error) {
        console.error('Admin API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
}
