import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { validateRequired, validateEmail } from './utils.js';



// Simple authentication (can be enhanced with JWT or database later)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tadrib2024';

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
    } else if (req.method === 'PUT') {
        return handlePut(req, res);
    } else if (req.method === 'DELETE') {
        return handleDelete(req, res);
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}

async function handleGet(req, res) {

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
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');

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

        // Try to get the "Leads" sheet first, fallback to first sheet
        let sheet;
        try {
            sheet = doc.sheetsByTitle["Leads"];
        } catch (e) {
            sheet = doc.sheetsByIndex[0]; // Fallback to first sheet
        }

        if (!sheet) {
            return res.status(500).json({ error: 'No sheets found in the spreadsheet' });
        }

        const rows = await sheet.getRows();

        // Process and clean the data from notify-fixed.js format
        const data = rows.map(row => ({
            timestamp: row.get('Timestamp') || '',
            status: row.get('Payment Status') || 'pending',
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

async function handlePut(req, res) {
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

        const { inquiryId, ...updateData } = req.body;

        if (!inquiryId) {
            return res.status(400).json({ error: 'Inquiry ID is required' });
        }

        // Validate environment variables
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');

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

        // Try to get the "Leads" sheet first, fallback to first sheet
        let sheet;
        try {
            sheet = doc.sheetsByTitle["Leads"];
        } catch (e) {
            sheet = doc.sheetsByIndex[0]; // Fallback to first sheet
        }

        if (!sheet) {
            return res.status(500).json({ error: 'No sheets found in the spreadsheet' });
        }

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

async function handleDelete(req, res) {
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

        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }

        // Validate environment variables
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');

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

        // Try to get the "Leads" sheet first, fallback to first sheet
        let sheet;
        try {
            sheet = doc.sheetsByTitle["Leads"];
        } catch (e) {
            sheet = doc.sheetsByIndex[0]; // Fallback to first sheet
        }

        if (!sheet) {
            return res.status(500).json({ error: 'No sheets found in the spreadsheet' });
        }

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
