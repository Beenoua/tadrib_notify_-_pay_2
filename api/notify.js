// --- تم الإصلاح: معالجة هيكلية بيانات YouCan Pay بشكل صحيح ---
import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { validateEmail, validatePhone, sanitizeString, validateRequired, normalizePhone, sanitizeTelegramHTML } from './utils.js';

// 2. إعدادات الأمان
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// التحقق من المتغيرات
if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY ||
    !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing required environment variables for notify service');
}

// 3. تهيئة Google Sheet
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

// مصادقة Google Sheets
async function authGoogleSheets() {
  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
}

export default async (req, res) => {
  // إعدادات CORS
  const allowedOrigins = [
    'https://tadrib.ma',
    'https://tadrib.jaouadouarh.com',
    'https://tadrib-cash.jaouadouarh.com',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin))
    res.setHeader('Access-Control-Allow-Origin', origin);

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let bot;

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    
    // --- [1. الخطوة الحاسمة: تطبيع البيانات (Normalization)] ---
    // نقرأ الجسم الأساسي
    let rawBody = req.body;
    let data; // الكائن الذي سنعمل عليه

    // هل هذا ويب هوك من YouCan؟ (يحتوي على event_name و data بداخله)
    if (rawBody.event_name && rawBody.data) {
        console.log("Detecting YouCan Webhook structure...");
        // نستخرج البيانات الحقيقية من داخل الغلاف
        const innerData = rawBody.data;
        
        // نعيد تشكيل البيانات لتكون مسطحة وسهلة القراءة
        data = {
            ...innerData, // يحتوي على transaction_id, customer, metadata
            status: 'paid', // الويب هوك عادة يعني نجاح الدفع (event_name: payment.succeeded)
            isWebhook: true
        };
        
        // التحقق من أن الحدث هو نجاح الدفع
        if (rawBody.event_name !== 'payment.succeeded' && rawBody.event_name !== 'transaction.paid') {
             console.log(`Event ignored: ${rawBody.event_name}`);
             return res.status(200).json({ message: 'Event ignored' });
        }

    } else {
        // هذه حالة الاتصال المباشر من الفرونت إند (مثلاً عند اختيار CashPlus)
        console.log("Detecting Direct API Call structure...");
        data = {
            ...rawBody,
            isWebhook: false // نحدد أنه ليس ويب هوك لنتجاوز بعض التحققات الصارمة
        };
    }

    // --- [2. استخراج اللغة والبيانات] ---
    const lang = data.metadata?.lang || data.currentLang || 'fr';
    const t = telegramTranslations[lang];

    // --- [3. التحقق من الحقول (Validation)] ---
    if (data.isWebhook) {
      // للويب هوك: نبحث داخل customer و metadata
      // هذا كان سبب الخطأ سابقاً: كنا نبحث في data مباشرة
      if (!data.customer || !data.metadata) {
          throw new Error('Webhook missing customer or metadata objects');
      }
      validateRequired(data.customer, ['name', 'email', 'phone']);
      validateRequired(data.metadata, ['inquiryId']);
    } else {
      // للاتصال المباشر
      validateRequired(data, ['clientName', 'clientEmail', 'clientPhone', 'inquiryId']);
    }

    // التحقق من صحة الإيميل والهاتف
    const emailToValidate = data.isWebhook ? data.customer.email : data.clientEmail;
    const phoneToValidate = data.isWebhook ? data.customer.phone : data.clientPhone;

    if (emailToValidate && !validateEmail(emailToValidate)) {
      console.warn('Invalid email format, but proceeding:', emailToValidate);
    }
    
    // --- [4. توحيد هيكل البيانات النهائي (Mapping)] ---
    const normalizedData = {
      timestamp: new Date().toLocaleString('fr-CA'), // وقت السيرفر الحالي
      inquiryId: sanitizeString(data.isWebhook ? data.metadata.inquiryId : data.inquiryId),

      clientName: sanitizeString(data.isWebhook ? data.customer.name : data.clientName),
      clientEmail: sanitizeString(data.isWebhook ? data.customer.email : data.clientEmail),
      clientPhone: normalizePhone(data.isWebhook ? data.customer.phone : data.clientPhone),

      selectedCourse: sanitizeString(data.isWebhook ? data.metadata.course : data.selectedCourse),
      qualification: sanitizeString(data.isWebhook ? data.metadata.qualification : data.qualification),
      experience: sanitizeString(data.isWebhook ? data.metadata.experience : data.experience),

      // بيانات الدفع
      paymentMethod: sanitizeString(data.payment_method || data.metadata?.paymentMethod || 'Unknown'),
      // الويب هوك لا يرسل كود كاش بلوس عادة، بل يرسل المعاملة المكتملة
      cashplusCode: sanitizeString(data.cashplus_code || data.metadata?.cashplusCode || null),
      last4: sanitizeString(data.card?.last4 || data.metadata?.card?.last4 || null),
      amount: data.amount || data.metadata?.finalAmount || null,
      currency: data.currency || "MAD",
      lang: lang,

      // UTMs
      utm_source: sanitizeString(data.metadata?.utm_source || data.utm_source || ''),
      utm_medium: sanitizeString(data.metadata?.utm_medium || data.utm_medium || ''),
      utm_campaign: sanitizeString(data.metadata?.utm_campaign || data.utm_campaign || ''),
      utm_term: sanitizeString(data.metadata?.utm_term || data.utm_term || ''),
      utm_content: sanitizeString(data.metadata?.utm_content || data.utm_content || ''),

      paymentStatus: sanitizeString(data.status || data.paymentStatus || 'pending'),
      transactionId: sanitizeString(data.transaction_id || data.id || data.transactionId || 'N/A')
    };

    console.log(`Processing Order: ${normalizedData.inquiryId} - Status: ${normalizedData.paymentStatus}`);

    // --- [5. الحفظ في Google Sheets] ---
    try {
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
    } catch (sheetError) {
        console.error("Google Sheet Error (Non-fatal):", sheetError.message);
        // لا نوقف التنفيذ إذا فشل الشيت، المهم نرسل التنبيه
    }

    // --- [6. إرسال تنبيه Telegram] ---
    const message = `
${t.title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(normalizedData.selectedCourse)}
${t.qualification} ${sanitizeTelegramHTML(normalizedData.qualification)}
${t.experience} ${sanitizeTelegramHTML(normalizedData.experience)}
-----------------------------------
${t.method} ${sanitizeTelegramHTML(normalizedData.paymentMethod)}
${normalizedData.cashplusCode ? `${t.cashplusCode} ${sanitizeTelegramHTML(normalizedData.cashplusCode)}` : ''}
${normalizedData.last4 ? `${t.last4} ${sanitizeTelegramHTML(normalizedData.last4)}` : ''}
${t.amount} ${sanitizeTelegramHTML(normalizedData.amount)} ${normalizedData.currency}
${t.lang} ${sanitizeTelegramHTML(normalizedData.lang)}
-----------------------------------
${t.name} ${sanitizeTelegramHTML(normalizedData.clientName)}
${t.phone} ${sanitizeTelegramHTML(normalizedData.clientPhone)}
${t.email} ${sanitizeTelegramHTML(normalizedData.clientEmail)}
-----------------------------------
${t.req_id} ${sanitizeTelegramHTML(normalizedData.inquiryId)}
${t.status} <b>${sanitizeTelegramHTML(normalizedData.paymentStatus)}</b>
${t.tx_id} ${sanitizeTelegramHTML(normalizedData.transactionId)}
${t.time} ${sanitizeTelegramHTML(normalizedData.timestamp)}
    `;

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    res.status(200).json({ result: 'success', message: 'Webhook received and saved.' });

  } catch (error) {
    console.error("Webhook Error:", error.message);
    // إرسال رسالة خطأ واضحة
    res.status(400).json({ error: "Bad Request", message: error.message });
  }
};
