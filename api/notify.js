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
// --- تم التعديل: استخدام 'export default' بدلاً من 'module.exports' ---
export default async (req, res) => {
  
  // --- إعدادات CORS ---
  const allowedOrigins = [
    'https://tadrib.ma', 
    'https://tadrib.jaouadouarh.com', 
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
    // تهيئة البوت *داخل* الـ try
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN); 
    
    // ! ===================================
    // !           **هذا هو الإصلاح**
    // ! Vercel يحلل JSON تلقائياً، لا نستخدم JSON.parse()
    // ! ===================================
    const data = req.body; 
    
    const lang = data.currentLang && ['ar', 'fr', 'en'].includes(data.currentLang) ? data.currentLang : 'fr';
    const t = telegramTranslations[lang];

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
      "Timestamp": data.timestamp,
      "Inquiry ID": data.inquiryId,
      "Full Name": data.clientName,
      "Email": data.clientEmail,
      "Phone Number": data.clientPhone,
      "Selected Course": data.selectedCourse,
      "Qualification": data.qualification,
      "Experience": data.experience,
      "utm_source": data.utm_source || '',
      "utm_medium": data.utm_medium || '',
      "utm_campaign": data.utm_campaign || '',
      "utm_term": data.utm_term || '', 
      "utm_content": data.utm_content || '',
      "Payment Status": data.paymentStatus || 'Not Paid', 
      "Transaction ID": data.transactionId || '' 
    });

    // --- المهمة الثانية: إرسال إشعار فوري عبر Telegram ---
    const message = `
      ${t.title}
      -----------------------------------
      ${t.course} ${data.selectedCourse}
      ${t.qualification} ${data.qualification}
      ${t.experience} ${data.experience}
      -----------------------------------
      ${t.name} ${data.clientName}
      ${t.phone} ${data.clientPhone}
      ${t.email} ${data.clientEmail}
      -----------------------------------
      ${t.status} ${data.paymentStatus}
      ${t.tx_id} ${data.transactionId}
      ${t.time} ${data.timestamp}
    `;
    
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });

    res.status(200).json({ result: 'success', message: 'Data saved and notification sent.' });

  } catch (error) {
    console.error('Error:', error);
    
    try {
      if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
      }
      await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ في نظام الحجز:\n${error.message}`);
    } catch (telegramError) {
      console.error('CRITICAL: Failed to send error to Telegram:', telegramError);
    }
    
    res.status(500).json({ result: 'error', message: 'Internal Server Error' });
  }
};

