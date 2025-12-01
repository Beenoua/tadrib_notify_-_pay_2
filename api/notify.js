import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { validateEmail, validatePhone, sanitizeString, validateRequired, normalizePhone, sanitizeTelegramHTML } from './utils.js';

// 1. إعدادات الأمان
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// التحقق من المتغيرات البيئية
if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY ||
    !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('CRITICAL: Missing required environment variables for notify service');
}

// 2. تهيئة Google Sheet
let doc;

// ترجمة الرسائل
const telegramTranslations = {
  ar: {
    title: "✅ <b>حجز مدفوع جديد (Tadrib.ma)</b> 💳",
    course: "<b>الدورة:</b>",
    qualification: "<b>المؤهل:</b>",
    experience: "<b>الخبرة:</b>",
    name: "<b>الاسم:</b>",
    phone: "<b>الهاتف:</b>",
    email: "<b>الإيميل:</b>",
    time: "<b>الوقت:</b>",
    status: "<b>الحالة:</b>",
    tx_id: "<b>رقم المعاملة:</b>",
    req_id: "<b>معرف الطلب:</b>",
    method: "<b>طريقة الأداء:</b>",
    amount: "<b>المبلغ:</b>",
    currency: "<b>العملة:</b>",
    lang: "<b>اللغة:</b>",
    cashplusCode: "<b>كود كاش بلوس:</b>",
    last4: "<b>آخر 4 أرقام:</b>"
  },
  fr: {
    title: "✅ <b>Nouvelle Réservation Payée (Tadrib.ma)</b> 💳",
    course: "<b>Formation:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Expérience:</b>",
    name: "<b>Nom:</b>",
    phone: "<b>Téléphone:</b>",
    email: "<b>E-mail:</b>",
    time: "<b>Heure:</b>",
    status: "<b>Statut:</b>",
    tx_id: "<b>ID Transaction:</b>",
    req_id: "<b>ID Requête:</b>",
    method: "<b>Méthode:</b>",
    amount: "<b>Montant:</b>",
    currency: "<b>Devise:</b>",
    lang: "<b>Langue:</b>",
    cashplusCode: "<b>Code CashPlus:</b>",
    last4: "<b>4 Derniers:</b>"
  },
  en: {
    title: "✅ <b>New Paid Booking (Tadrib.ma)</b> 💳",
    course: "<b>Course:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Experience:</b>",
    name: "<b>Name:</b>",
    phone: "<b>Phone:</b>",
    email: "<b>Email:</b>",
    time: "<b>Time:</b>",
    status: "<b>Status:</b>",
    tx_id: "<b>Transaction ID:</b>",
    req_id: "<b>Request ID:</b>",
    method: "<b>Method:</b>",
    amount: "<b>Amount:</b>",
    currency: "<b>Currency:</b>",
    lang: "<b>Lang:</b>",
    cashplusCode: "<b>CashPlus Code:</b>",
    last4: "<b>Card Last 4:</b>"
  }
};

// دالة مصادقة Google Sheets
async function authGoogleSheets() {
  try {
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
  } catch (e) {
    console.error("Google Sheets Auth Error:", e.message);
  }
}

export default async (req, res) => {
  // CORS
  const allowedOrigins = [
    'https://tadrib.ma',
    'https://tadrib.jaouadouarh.com',
    'https://tadrib-cash.jaouadouarh.com',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let bot;

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    const body = req.body;

    console.log("Incoming Payload:", JSON.stringify(body).substring(0, 300)); // Log for debugging

    // --- [الجزء السحري] طبقة استخراج البيانات (Extraction Layer) ---
    // هذا الجزء يحدد أين توجد البيانات الحقيقية سواء كانت مسطحة (Postman) أو متداخلة (Real)
    
    let sourceData = body; // الافتراضي: البيانات في الجذر
    let isNested = false;

    // التحقق مما إذا كانت البيانات داخل payload.transaction (بوابة الدفع الحقيقية)
    if (body.payload && body.payload.transaction) {
        sourceData = body.payload.transaction;
        isNested = true;
    }

    // تحديد كائنات البيانات الفرعية بناءً على المصدر المحدد
    const customer = sourceData.customer || {};
    const metadata = sourceData.metadata || {};
    const card = sourceData.card || {};
    const cashplus = sourceData.cashplus || {};

    // --- 1. استخراج الحقول الأساسية ---
    // نبحث في الكائن المستخرج (sourceData) بدلاً من الجسم الرئيسي (body)
    
    const rawName = customer.name || sourceData.clientName || body.clientName || 'Unknown';
    const rawEmail = customer.email || sourceData.clientEmail || body.clientEmail || 'Unknown';
    const rawPhone = customer.phone || sourceData.clientPhone || body.clientPhone || 'Unknown';
    
    // inquiryId قد يكون order_id في البوابة الحقيقية
    const rawInquiryId = metadata.inquiryId || sourceData.order_id || sourceData.inquiryId || body.inquiryId;

    // --- 2. التحقق من البيانات (Validation) ---
    // إذا لم نجد البيانات، نوقف العملية ونصدر خطأ واضحاً
    if (!rawName || rawName === 'Unknown' || !rawInquiryId) {
         // نسمح بمرور 'Unknown' مؤقتاً إذا كان مجرد اختبار، لكن نسجل تحذيراً
         console.warn("Partial data detected via webhook.");
    }

    // --- 3. استخراج ومعالجة الحالة (Status) ---
    let statusRaw = sourceData.status || body.paymentStatus || 'pending';
    let finalStatus = String(statusRaw);

    // *تعديل هام*: YouCanPay ترسل الحالة كرقم 1 عند النجاح
    if (statusRaw === 1 || statusRaw === '1' || statusRaw === 'paid') {
        finalStatus = 'paid';
    } else if (statusRaw === -1) {
        finalStatus = 'failed';
    }

    // --- 4. استخراج باقي البيانات ---
    const rawCourse = metadata.course || sourceData.selectedCourse || 'N/A';
    const rawQual = metadata.qualification || sourceData.qualification || 'N/A';
    const rawExp = metadata.experience || sourceData.experience || 'N/A';
    const rawLang = metadata.lang || sourceData.currentLang || 'fr';
    
    let rawAmount = sourceData.amount || metadata.finalAmount || null;
    // أحياناً المبلغ يكون بـ السنتيم (Centimes)
    if (rawAmount && rawAmount > 10000) rawAmount = rawAmount / 100; // تصحيح إذا لزم الأمر

    // --- 5. بناء الكائن الموحد (Normalized Data) ---
    const normalizedData = {
      timestamp: new Date().toLocaleString('fr-CA'),
      inquiryId: sanitizeString(rawInquiryId),
      clientName: sanitizeString(rawName),
      clientEmail: sanitizeString(rawEmail),
      clientPhone: normalizePhone(rawPhone),
      selectedCourse: sanitizeString(rawCourse),
      qualification: sanitizeString(rawQual),
      experience: sanitizeString(rawExp),
      
      paymentMethod: sanitizeString(sourceData.payment_method || metadata.paymentMethod || 'card'),
      cashplusCode: sanitizeString(cashplus.code || null),
      last4: sanitizeString(card.last4 || metadata.card?.last4 || null),
      
      amount: rawAmount,
      currency: sourceData.currency || "MAD",
      lang: rawLang,

      utm_source: sanitizeString(metadata.utm_source || body.utm_source || ''),
      utm_medium: sanitizeString(metadata.utm_medium || body.utm_medium || ''),
      
      paymentStatus: sanitizeString(finalStatus),
      transactionId: sanitizeString(sourceData.id || sourceData.transaction_id || body.transaction_id || 'N/A')
    };

    // --- 6. الترجمة ---
    const t = telegramTranslations[normalizedData.lang] || telegramTranslations['fr'];

    // --- 7. الحفظ في Google Sheets ---
    try {
        if (doc) {
            await authGoogleSheets();
            let sheet = doc.sheetsByTitle["Leads"];
            if (!sheet) sheet = await doc.addSheet({ title: "Leads" });

            const headers = [
            "Timestamp", "Inquiry ID", "Full Name", "Email", "Phone Number",
            "Selected Course", "Qualification", "Experience",
            "Payment Method", "CashPlus Code", "Last4Digits",
            "Amount", "Currency", "Lang",
            "utm_source", "utm_medium", 
            "Payment Status", "Transaction ID"
            ];

            await sheet.loadHeaderRow();
            if (sheet.headerValues.length === 0) await sheet.setHeaderRow(headers);

            await sheet.addRow({
            "Timestamp": normalizedData.timestamp,
            "Inquiry ID": normalizedData.inquiryId,
            "Full Name": normalizedData.clientName,
            "Email": normalizedData.clientEmail,
            "Phone Number": normalizedData.clientPhone,
            "Selected Course": normalizedData.selectedCourse,
            "Qualification": normalizedData.qualification,
            "Experience": normalizedData.experience,
            "Payment Method": normalizedData.paymentMethod,
            "CashPlus Code": normalizedData.cashplusCode,
            "Last4Digits": normalizedData.last4,
            "Amount": normalizedData.amount,
            "Currency": normalizedData.currency,
            "Lang": normalizedData.lang,
            "utm_source": normalizedData.utm_source,
            "utm_medium": normalizedData.utm_medium,
            "Payment Status": normalizedData.paymentStatus,
            "Transaction ID": normalizedData.transactionId
            });
        }
    } catch (sheetError) {
        console.error("Sheet Error:", sheetError.message);
    }

    // --- 8. إرسال Telegram ---
    const message = `
${t.title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(normalizedData.selectedCourse)}
${t.qualification} ${sanitizeTelegramHTML(normalizedData.qualification)}
${t.experience} ${sanitizeTelegramHTML(normalizedData.experience)}
-----------------------------------
${t.method} ${sanitizeTelegramHTML(normalizedData.paymentMethod)}
${normalizedData.cashplusCode ? `${t.cashplusCode} ${sanitizeTelegramHTML(normalizedData.cashplusCode)}\n` : ''}${normalizedData.last4 ? `${t.last4} ${sanitizeTelegramHTML(normalizedData.last4)}\n` : ''}${t.amount} ${sanitizeTelegramHTML(normalizedData.amount)} ${normalizedData.currency}
${t.lang} ${sanitizeTelegramHTML(normalizedData.lang)}
-----------------------------------
${t.name} ${sanitizeTelegramHTML(normalizedData.clientName)}
${t.phone} ${sanitizeTelegramHTML(normalizedData.clientPhone)}
${t.email} ${sanitizeTelegramHTML(normalizedData.clientEmail)}
-----------------------------------
${t.req_id} ${sanitizeTelegramHTML(normalizedData.inquiryId)}
${t.status} ${sanitizeTelegramHTML(normalizedData.paymentStatus)}
${t.tx_id} ${sanitizeTelegramHTML(normalizedData.transactionId)}
${t.time} ${sanitizeTelegramHTML(normalizedData.timestamp)}
    `;

    try {
        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
    } catch (botError) {
         console.error("Telegram Error:", botError.message);
    }

    res.status(200).json({ result: 'success', message: 'Notification processed.' });

  } catch (error) {
    console.error("Handler Error:", error.message);
    res.status(400).json({ error: "Bad Request", message: error.message });
  }
};
