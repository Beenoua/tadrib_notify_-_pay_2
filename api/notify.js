import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { validateEmail, normalizePhone, sanitizeString, sanitizeTelegramHTML } from './utils.js';
import crypto from 'crypto';

// --- [إضافة جديدة] إعدادات لتعطيل معالجة Vercel التلقائية ---
export const config = {
  api: {
    bodyParser: false,
  },
};

// --- [إضافة جديدة] دالة لقراءة البيانات الخام ---
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// 1. إعدادات الأمان
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;

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

function verifyYouCanSignature(privateKey, payload, receivedSignature) {
  if (!privateKey || !receivedSignature) return false;
  
  // إذا كان الـ payload نصاً (وهو ما نريده) نستخدمه، وإلا نحوله (للاحتياط)
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const signature = crypto
    .createHmac('sha256', privateKey)
    .update(content)
    .digest('hex');
    
  return signature === receivedSignature;
}

export default async (req, res) => {
  // CORS Setup
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
    // 1. قراءة البيانات الخام (Raw Body)
    const rawBody = await getRawBody(req);
    let body;
    try {
        body = JSON.parse(rawBody);
    } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        return res.status(400).json({ message: 'Invalid JSON' });
    }

    // --- Security Check: Verify YouCanPay Signature ---
    const signature = req.headers['youcan-pay-signature'] || req.headers['x-youcanpay-signature'];

    console.log("Security Debug:", { 
        hasPrivateKey: !!YOUCAN_PRIVATE_KEY, 
        receivedSignature: signature ? "Yes (Hidden)" : "Missing"
    });
    
    if (YOUCAN_PRIVATE_KEY && signature) {
        // [مهم] نمرر rawBody للتحقق بدلاً من body
        const isValid = verifyYouCanSignature(YOUCAN_PRIVATE_KEY, rawBody, signature);
        
        if (!isValid) {
            console.error('Invalid Webhook Signature detected!');
            return res.status(401).json({ message: 'Invalid Signature' });
        }
        console.log('Webhook Signature Verified ✅');
    } else {
        console.warn('Skipping signature verification (Missing Key or Signature header)');
    }
    // --------------------------------------------------

    console.log("Incoming Payload:", JSON.stringify(body).substring(0, 500)); 

    // --- [تحسين جذري] استخراج البيانات متعدد المستويات (Multi-Level Extraction) ---
    
    // 1. تحديد المصادر المحتملة للبيانات
    const payload = body.payload || {};
    const transaction = payload.transaction || body.transaction || {}; 
    
    // ملاحظة: transaction هي المصدر الأوثق للحالة والمبلغ
    
    // 2. البحث عن Customer في كل مكان (الأولوية للداخل ثم الخارج)
    const customer = transaction.customer || payload.customer || body.customer || {};
    
    // 3. البحث عن Metadata في كل مكان
    const metadata = transaction.metadata || payload.metadata || body.metadata || {};

    // 4. البحث عن معلومات البطاقة (تحديث شامل لالتقاط last_digits)
    // أولاً: نحدد كائن payment_method إذا وجد (لأنه يحتوي على البطاقة غالباً)
    const pmObj = transaction.payment_method || payload.payment_method || body.payment_method || {};
    
    // ثانياً: نبحث عن كائن البطاقة card في كل الأماكن المحتملة
    const card = transaction.card || payload.card || body.card || metadata.card || pmObj.card || {};
    
    // ثالثاً: نستخرج الأرقام (YouCanPay تسميها last_digits أحياناً)
    const finalLast4 = sanitizeString(card.last4 || card.last_digits || metadata.last4 || null);
    
    // 5. البحث عن معلومات CashPlus
    const cashplus = transaction.cashplus || payload.cashplus || body.cashplus || {};

    // --- استخراج الحقول الآن (أكثر أماناً) ---

    // الاسم، الإيميل، الهاتف (نبحث في كائن customer أولاً، ثم الحقول المباشرة)
    const rawName = customer.name || body.clientName || body.name || 'Unknown';
    const rawEmail = customer.email || body.clientEmail || body.email || 'Unknown';
    const rawPhone = customer.phone || body.clientPhone || body.phone || 'Unknown';

    // معرف الطلب (Order ID)
    // هذا مهم: في الويب هوك يأتي غالباً في transaction.order_id
    const rawInquiryId = transaction.order_id || metadata.inquiryId || body.inquiryId || payload.order_id || 'N/A';

    // --- معالجة الحالة والمبلغ (من transaction حصراً إذا وجدت) ---
    let statusRaw = transaction.status !== undefined ? transaction.status : (body.paymentStatus || body.status || 'pending');
    let finalStatus = String(statusRaw);

    if (statusRaw === 1 || statusRaw === '1' || statusRaw === 'paid') {
        finalStatus = 'paid';
    } else if (statusRaw === -1) {
        finalStatus = 'failed';
    }

    // معالجة المبلغ (تحويل من السنتيم إذا لزم الأمر)
    let rawAmount = transaction.amount || body.amount || metadata.finalAmount || null;
    if (rawAmount && rawAmount > 10000) rawAmount = rawAmount / 100; 

    // باقي التفاصيل من Metadata
    const rawCourse = metadata.course || body.selectedCourse || 'N/A';
    const rawQual = metadata.qualification || body.qualification || 'N/A';
    const rawExp = metadata.experience || body.experience || 'N/A';
    const rawLang = metadata.lang || body.currentLang || body.lang || 'fr';

    // --- بناء الكائن النهائي الموحد ---
    const normalizedData = {
      timestamp: new Date().toLocaleString('fr-CA'),
      inquiryId: sanitizeString(rawInquiryId),
      clientName: sanitizeString(rawName),
      clientEmail: sanitizeString(rawEmail),
      clientPhone: normalizePhone(rawPhone),
      
      selectedCourse: sanitizeString(rawCourse),
      qualification: sanitizeString(rawQual),
      experience: sanitizeString(rawExp),
      
      paymentMethod: sanitizeString(pmObj.name || transaction.payment_method || body.payment_method || metadata.paymentMethod || 'card'),
      cashplusCode: sanitizeString(cashplus.code || null),
      last4: finalLast4,
      
      amount: rawAmount,
      currency: transaction.currency || body.currency || "MAD",
      lang: rawLang,

      utm_source: sanitizeString(metadata.utm_source || body.utm_source || ''),
      utm_medium: sanitizeString(metadata.utm_medium || body.utm_medium || ''),
      utm_campaign: sanitizeString(metadata.utm_campaign || body.utm_campaign || ''),
      utm_term: sanitizeString(metadata.utm_term || body.utm_term || ''),
      utm_content: sanitizeString(metadata.utm_content || body.utm_content || ''),
      
      paymentStatus: sanitizeString(finalStatus),
      // transaction ID يأتي من id داخل transaction أو id الخارجي
      transactionId: sanitizeString(transaction.id || body.transaction_id || body.id || 'N/A')
    };

    // --- سجل للتحقق (Debug) ---
    if (normalizedData.clientName === 'Unknown') {
        console.warn("STILL UNKNOWN DATA. Structure dump:", JSON.stringify({
            hasTransaction: !!payload.transaction,
            hasCustomerInTrans: !!transaction.customer,
            hasMetadataInTrans: !!transaction.metadata,
            hasCustomerInPayload: !!payload.customer,
            keysInTransaction: Object.keys(transaction)
        }));
    }

    // --- الترجمة ---
    const t = telegramTranslations[normalizedData.lang] || telegramTranslations['fr'];

   // --- الحفظ في Google Sheets ---
    try {
        // [تصحيح]: نستدعي دالة الاتصال أولاً لملء المتغير doc
        await authGoogleSheets(); 

        // الآن نتحقق إذا تم الاتصال بنجاح
        if (doc) {
            let sheet = doc.sheetsByTitle["Leads"];
            if (!sheet) sheet = await doc.addSheet({ title: "Leads" });

            const headers = [
            "Timestamp", "Inquiry ID", "Full Name", "Email", "Phone Number",
            "Selected Course", "Qualification", "Experience",
            "Payment Method", "CashPlus Code", "Last4Digits",
            "Amount", "Currency", "Lang",
            "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", 
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
            "utm_campaign": normalizedData.utm_campaign,
            "utm_term": normalizedData.utm_term,
            "utm_content": normalizedData.utm_content,
            "Payment Status": normalizedData.paymentStatus,
            "Transaction ID": normalizedData.transactionId
            });
            console.log("Successfully saved to Google Sheets");
        } else {
            console.error("Google Sheets doc is not initialized.");
        }
    } catch (sheetError) {
        console.error("Sheet Error:", sheetError.message);
    }

    // --- إرسال Telegram ---
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
