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

// ترجمة الرسائل للإشعارات
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
    // لا نوقف التنفيذ هنا لكي يعمل التيليجرام حتى لو فشل الشيت
  }
}

// --- المعالج الرئيسي (Main Handler) ---
export default async (req, res) => {
  // 1. إعدادات CORS (تسمح لـ YouCanPay بالدخول)
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
    // السماح للويب هوكس (Webhooks) التي غالباً لا ترسل Origin header
    res.setHeader('Access-Control-Allow-Origin', '*'); 
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let bot;

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    const data = req.body;

    // تسجيل البيانات القادمة للمساعدة في التتبع (Log)
    console.log("Notification Payload Received:", JSON.stringify(data).substring(0, 250) + "...");

    // 2. الكشف الذكي عن المصدر (Webhook vs Frontend)
    const isWebhook =
      data.object === "event" ||               
      (data.customer && typeof data.customer === 'object') ||                         
      (data.metadata && data.metadata.paymentMethod) ||          
      data.payment_method !== undefined ||                   
      data.transaction_id !== undefined ||
      data.id !== undefined ||
      data.status !== undefined;

    // 3. توحيد البيانات (Data Normalization) - الخطوة الأهم لحل المشاكل
    // نبحث عن البيانات في كل الأماكن المحتملة ونوحدها في متغيرات نهائية
    
    // الاسم
    const rawName = isWebhook 
        ? (data.customer?.name || data.metadata?.clientName) 
        : (data.clientName || data.name);

    // البريد الإلكتروني
    const rawEmail = isWebhook 
        ? (data.customer?.email || data.metadata?.clientEmail) 
        : (data.clientEmail || data.email);

    // الهاتف
    const rawPhone = isWebhook 
        ? (data.customer?.phone || data.metadata?.clientPhone) 
        : (data.clientPhone || data.phone);

    // معرف الطلب
    const rawInquiryId = isWebhook 
        ? (data.metadata?.inquiryId || data.order_id || data.inquiryId) 
        : (data.inquiryId);

    // 4. التحقق من صحة البيانات الموحدة (Validation)
    if (!rawName || !rawEmail || !rawPhone || !rawInquiryId) {
        // تفاصيل الخطأ للمساعدة في التصحيح
        const missing = [];
        if (!rawName) missing.push('Name');
        if (!rawEmail) missing.push('Email');
        if (!rawPhone) missing.push('Phone');
        if (!rawInquiryId) missing.push('InquiryId');
        
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // التحقق من صيغة الإيميل (اختياري، تحذير فقط)
    if (rawEmail && !validateEmail(rawEmail)) {
        console.warn('Warning: Invalid email format:', rawEmail);
    }

    // 5. تحديد اللغة
    let lang = 'fr';
    if (data.metadata?.lang) lang = data.metadata.lang;
    else if (data.currentLang) lang = data.currentLang;
    else if (data.lang) lang = data.lang;

    const t = telegramTranslations[lang] || telegramTranslations['fr'];

    // 6. تحديد الحالة (Payment Status)
    let rawStatus = isWebhook ? data.status : data.paymentStatus;
    // تنظيف الحالة: إذا كانت غير موجودة أو undefined نعتبرها 'pending'
    if (!rawStatus || String(rawStatus).trim().toLowerCase() === 'undefined') {
        rawStatus = 'pending';
    }

    // 7. تحديد طريقة الدفع (لتجنب التلوث)
    // إذا جاءت من الويب هوك نأخذها منه، وإلا نأخذها من الميتاداتا، وإلا من الفرونت إند
    let paymentMethod = data.payment_method || data.metadata?.paymentMethod || data.paymentMethod;
    if (!paymentMethod && isWebhook) paymentMethod = 'card/webhook'; // fallback

    // 8. بناء كائن البيانات النهائي (Normalized Data Object)
    const normalizedData = {
      timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
      inquiryId: sanitizeString(rawInquiryId),

      clientName: sanitizeString(rawName),
      clientEmail: sanitizeString(rawEmail),
      clientPhone: normalizePhone(rawPhone),

      selectedCourse: sanitizeString(data.metadata?.course || data.selectedCourse || 'N/A'),
      qualification: sanitizeString(data.metadata?.qualification || data.qualification || 'N/A'),
      experience: sanitizeString(data.metadata?.experience || data.experience || 'N/A'),

      paymentMethod: sanitizeString(paymentMethod),
      
      cashplusCode: sanitizeString(data.cashplus?.code || null),
      last4: sanitizeString(data.card?.last4 || data.metadata?.card?.last4 || null),
      amount: data.amount || data.metadata?.finalAmount || null,
      currency: data.currency || "MAD",
      lang: lang,

      utm_source: sanitizeString(data.utm_source || ''),
      utm_medium: sanitizeString(data.utm_medium || ''),
      utm_campaign: sanitizeString(data.utm_campaign || ''),
      utm_term: sanitizeString(data.utm_term || ''),
      utm_content: sanitizeString(data.utm_content || ''),

      paymentStatus: sanitizeString(String(rawStatus)),
      transactionId: sanitizeString(isWebhook ? (data.transaction_id || data.id) : (data.transactionId || 'N/A'))
    };

    // 9. الحفظ في Google Sheets
    try {
        if (doc) { // فقط إذا تمت التهيئة بنجاح
            await authGoogleSheets();
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
        }
    } catch (sheetError) {
        console.error("Sheet Saving Error:", sheetError.message);
        // نستمر لإرسال رسالة التيليجرام
    }

    // 10. إرسال رسالة التيليجرام
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

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    // الرد بنجاح
    res.status(200).json({ result: 'success', message: 'Notification processed successfully.' });

  } catch (error) {
    console.error("Notify API Error:", error.message);
    
    // إرسال رد واضح للعميل (أو بوابة الدفع)
    let clientMessage = "An error occurred while processing the notification";
    if (error.message.includes('Missing required fields')) {
      clientMessage = error.message;
    }

    res.status(400).json({ error: "Bad Request", message: clientMessage });
  }
};
