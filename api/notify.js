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

// --- ترجمات التيليغرام ---
const telegramTranslations = {
  ar: {
    title: "✅ **حجز مدفوع جديد (Tadrib.ma)** 💳", 
    course: "**الدورة:**",
    qualification: "**المؤهل:**",
    experience: "**الخبرة:**",
    name: "**الاسم:**",
    phone: "**الهاتف:**",
    email: "**الإيميل:**",
    time: "**الوقت:**",
    status: "**الحالة:**", 
    tx_id: "**رقم المعاملة:**" 
  },
  fr: {
    title: "✅ **Nouvelle Réservation Payée (Tadrib.ma)** 💳", 
    course: "**Formation:**",
    qualification: "**Qualification:**",
    experience: "**Expérience:**",
    name: "**Nom:**",
    phone: "**Téléphone:**",
    email: "**E-mail:**",
    time: "**Heure:**",
    status: "**Statut:**", 
    tx_id: "**ID Transaction:**" 
  },
  en: {
    title: "✅ **New Paid Booking (Tadrib.ma)** 💳", 
    course: "**Course:**",
    qualification: "**Qualification:**",
    experience: "**Experience:**",
    name: "**Name:**",
    phone: "**Phone:**",
    email: "**Email:**",
    time: "**Time:**",
    status: "**Status:**", 
    tx_id: "**Transaction ID:**" 
  }
};

/**
 * --- !!! [الإصلاح: دالة تنظيف الماركداون] !!! ---
 * هذه الدالة تقوم بإزالة الأحرف الخاصة التي تسبب خطأ في Telegram
 * @param {string} text النص المراد تنظيفه
 * @returns {string} نص آمن للإرسال
 */
function sanitizeTelegram(text) {
  if (typeof text !== 'string') {
    return text;
  }
  // هذه الأحرف تتسبب في كسر تنسيق الماركداون V2
  const charsToEscape = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  let escapedText = text;
  
  // نقوم باستبدال كل حرف بنسخته الآمنة
  // نستخدم \ قبل الحرف لإلغاء تنسيقه
  charsToEscape.forEach(char => {
    escapedText = escapedText.replace(new RegExp('\\' + char, 'g'), '\\' + char);
  });
  
  return escapedText;
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
    
    // --- !!! [الإصلاح: تنظيف البيانات قبل إرسالها] !!! ---
    const message = `
      ${t.title}
      -----------------------------------
      ${t.course} ${sanitizeTelegram(normalizedData.selectedCourse)}
      ${t.qualification} ${sanitizeTelegram(normalizedData.qualification)}
      ${t.experience} ${sanitizeTelegram(normalizedData.experience)}
      -----------------------------------
      ${t.name} ${sanitizeTelegram(normalizedData.clientName)}
      ${t.phone} ${sanitizeTelegram(normalizedData.clientPhone)}
      ${t.email} ${sanitizeTelegram(normalizedData.clientEmail)}
      -----------------------------------
      ${t.status} ${sanitizeTelegram(normalizedData.paymentStatus)}
      ${t.tx_id} ${sanitizeTelegram(normalizedData.transactionId)}
      ${t.time} ${sanitizeTelegram(normalizedData.timestamp)}
    `;
    // --- !!! [نهاية الإصلاح] !!! ---
    
    // [تعديل] استخدام MarkdownV2 الأكثر صرامة
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'MarkdownV2' });

    res.status(200).json({ result: 'success', message: 'Data saved and notification sent.' });

  } catch (error) {
    console.error('Error:', error);
    
    try {
      if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
      }
      // إرسال رسالة خطأ بسيطة بدون ماركداون لضمان وصولها
      await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ في نظام الحجز:\n${error.message}`);
    } catch (telegramError) {
      console.error('CRITICAL: Failed to send error to Telegram:', telegramError);
    }
    
    res.status(500).json({ result: 'error', message: 'Internal Server Error' });
  }
};
