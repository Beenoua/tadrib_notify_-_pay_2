// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';

// 2. إعدادات الأمان (يتم قراءتها من متغيرات البيئة)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 3. تهيئة الخدمات
let doc; 

// --- [إصلاح] ترجمات التيليغرام (استخدام HTML) ---
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
    req_id: "<b>معرف الطلب:</b>"
  
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
    req_id: "<b>ID de requête:</b>" // <-- تمت الإضافة
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
    req_id: "<b>Request ID:</b>" // <-- تمت الإضافة
  }
};
// --- نهاية الإصلاح ---

/**
 * --- !!! [الإصلاح: دالة تنظيف لـ HTML] !!! ---
 * هذه الدالة تضمن عدم كسر تنسيق HTML
 * @param {string} text النص المراد تنظيفه
 * @returns {string} نص آمن للإرسال
 */
function sanitizeTelegramHTML(text) {
  if (typeof text !== 'string') {
    return text;
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


/**
 * دالة المصادقة مع Google Sheets
 */
async function authGoogleSheets() {
  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo(); // تحميل معلومات الملف
}

/**
 * هذه هي الدالة الرئيسية التي تستقبل الطلبات
 */
export default async (req, res) => {
  
  // --- إعدادات CORS ---
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
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  let bot; 

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN); 
    const data = req.body; 
    
    const lang = (data.currentLang && ['ar', 'fr', 'en'].includes(data.currentLang)) ? data.currentLang : 'fr';
    const t = telegramTranslations[lang];

    const isWebhook = data.metadata && data.customer;

    const normalizedData = {
      timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
      inquiryId: isWebhook ? data.metadata.inquiryId : data.inquiryId,
      clientName: isWebhook ? data.customer.name : data.clientName,
      clientEmail: isWebhook ? data.customer.email : data.clientEmail,
      clientPhone: isWebhook ? data.customer.phone : data.clientPhone,
      selectedCourse: isWebhook ? data.metadata.course : data.selectedCourse,
      qualification: isWebhook ? data.metadata.qualification : data.qualification,
      experience: isWebhook ? data.metadata.experience : data.experience,
      utm_source: data.utm_source || '',
      utm_medium: data.utm_medium || '',
      utm_campaign: data.utm_campaign || '',
      utm_term: data.utm_term || '', 
      utm_content: data.utm_content || '',
      paymentStatus: isWebhook ? data.status : (data.paymentStatus || 'pending'), 
      transactionId: isWebhook ? data.transaction_id : (data.transactionId || 'N/A') 
    };

    // --- المهمة الأولى: حفظ البيانات في Google Sheets ---
    await authGoogleSheets(); 
    
    let sheet = doc.sheetsByTitle["Leads"]; 
    if (!sheet) {
        sheet = await doc.addSheet({ title: "Leads" });
    }

    const headers = [
      "Timestamp", "Inquiry ID", "Full Name", "Email", "Phone Number", 
      "Selected Course", "Qualification", "Experience",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "Payment Status", "Transaction ID" 
    ];

    await sheet.loadHeaderRow(); 

    if (sheet.headerValues.length === 0) {
        await sheet.setHeaderRow(headers);
    }
    
    await sheet.addRow({
      "Timestamp": normalizedData.timestamp,
      "Inquiry ID": normalizedData.inquiryId,
      "Full Name": normalizedData.clientName,
      "Email": normalizedData.clientEmail,
      "Phone Number": normalizedData.clientPhone,
      "Selected Course": normalizedData.selectedCourse,
      "Qualification": normalizedData.qualification,
      "Experience": normalizedData.experience,
      "utm_source": normalizedData.utm_source,
      "utm_medium": normalizedData.utm_medium,
      "utm_campaign": normalizedData.utm_campaign,
      "utm_term": normalizedData.utm_term, 
      "utm_content": normalizedData.utm_content,
      "Payment Status": normalizedData.paymentStatus, 
      "Transaction ID": normalizedData.transactionId 
    });

    // --- المهمة الثانية: إرسال إشعار فوري عبر Telegram ---
    
    // --- !!! [الإصلاح: تنظيف البيانات لـ HTML] !!! ---
    const message = `
${t.title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(normalizedData.selectedCourse)}
${t.qualification} ${sanitizeTelegramHTML(normalizedData.qualification)}
${t.experience} ${sanitizeTelegramHTML(normalizedData.experience)}
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
    // --- !!! [نهاية الإصلاح] !!! ---
    
    // [تعديل] استخدام HTML
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    res.status(200).json({ result: 'success', message: 'Data saved and notification sent.' });

  } catch (error) {
    console.error('Error:', error);
    
    try {
      if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
      }
      // إرسال رسالة خطأ بسيطة بدون تنسيق لضمان وصولها
      await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ في نظام الحجز:\n${error.message}`);
    } catch (telegramError) {
      console.error('CRITICAL: Failed to send error to Telegram:', telegramError);
    }
    
    res.status(500).json({ result: 'error', message: 'Internal Server Error' });
  }
};

