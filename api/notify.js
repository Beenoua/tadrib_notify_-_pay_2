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

// --- [تعديل جذري]: ترجمات التيليغرام ---
const telegramTranslations = {
  ar: {
    title_paid: "✅ <b>حجز مدفوع جديد (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>حجز معلق (CashPlus)</b> ⏳", 
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
    // --- [جديد] ---
    amount: "<b>المبلغ:</b>",
    method: "<b>طريقة الدفع:</b>",
    cashplus_code: "<b>كود كاش بلوس:</b>",
    card_last_four: "<b>آخر 4 أرقام:</b>",
    utm_source: "<b>المصدر (UTM):</b>"
  },
  fr: {
    title_paid: "✅ <b>Nouvelle Réservation Payée (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>Réservation en attente (CashPlus)</b> ⏳",
    course: "<b>Formation:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Expérience:</b>",
    name: "<b>Nom:</b>",
    phone: "<b>Téléphone:</b>",
    email: "<b>E-mail:</b>",
    time: "<b>Heure:</b>",
    status: "<b>Statut:</b>", 
    tx_id: "<b>ID Transaction:</b>",
    req_id: "<b>ID de requête:</b>",
    // --- [جديد] ---
    amount: "<b>Montant:</b>",
    method: "<b>Méthode:</b>",
    cashplus_code: "<b>Code CashPlus:</b>",
    card_last_four: "<b>4 derniers chiffres:</b>",
    utm_source: "<b>Source (UTM):</b>"
  },
  en: {
    title_paid: "✅ <b>New Paid Booking (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>Pending Booking (CashPlus)</b> ⏳",
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
    // --- [جديد] ---
    amount: "<b>Amount:</b>",
    method: "<b>Method:</b>",
    cashplus_code: "<b>CashPlus Code:</b>",
    card_last_four: "<b>Card Last Four:</b>",
    utm_source: "<b>Source (UTM):</b>"
  }
};
// --- نهاية التعديل ---

/**
 * دالة تنظيف لـ HTML
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
    
    // --- [تعديل جذري]: توحيد البيانات (Webhook أو Manual) ---

    // (isWebhook = true) إذا كان الطلب من خادم YouCanPay (يحتوي على customer و metadata)
    // (isWebhook = false) إذا كان الطلب يدوياً من script-cleaned-2.js (مثل pending_cashplus)
    const isWebhook = !!(data.metadata && data.customer); 
    
    const metadata = isWebhook ? data.metadata : {};
    const customer = isWebhook ? data.customer : {};

    const normalizedData = {
      timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
      
      // بيانات الحجز (تأتي من metadata إذا كان webhook، أو من data مباشرة إذا كان يدوياً)
      inquiryId: isWebhook ? metadata.inquiryId : data.inquiryId,
      clientName: isWebhook ? customer.name : data.clientName,
      clientEmail: isWebhook ? customer.email : data.clientEmail,
      clientPhone: isWebhook ? customer.phone : data.clientPhone,
      selectedCourse: isWebhook ? metadata.selectedCourse : data.selectedCourse,
      qualification: isWebhook ? metadata.qualification : data.qualification,
      experience: isWebhook ? metadata.experience : data.experience,
      
      // بيانات الدفع (الجديدة)
      paymentMethod: isWebhook ? metadata.paymentMethod : (data.paymentStatus === 'pending_cashplus' ? 'CashPlus' : 'N/A'),
      cashplusCode: data.cashplusCode || 'N/A', // يأتي فقط من الإشعار اليدوي
      amount: isWebhook ? (data.amount / 100) : data.amount, // Webhook يرسل بالسنتيم، اليدوي بالدرهم
      currency: isWebhook ? data.currency : (data.currency || 'MAD'),
      cardLastFour: isWebhook ? (data.card_last_four || 'N/A') : 'N/A', // محاولة قراءته من الـ Webhook
      
      // بيانات التتبع (UTM)
      utm_source: isWebhook ? metadata.utm_source : (data.utm_source || ''),
      utm_medium: isWebhook ? metadata.utm_medium : (data.utm_medium || ''),
      utm_campaign: isWebhook ? metadata.utm_campaign : (data.utm_campaign || ''),
      utm_term: isWebhook ? metadata.utm_term : (data.utm_term || ''),
      utm_content: isWebhook ? metadata.utm_content : (data.utm_content || ''),
      
      // بيانات الحالة
      paymentStatus: isWebhook ? data.status : (data.paymentStatus || 'pending'), 
      transactionId: isWebhook ? data.transaction_id : (data.transactionId || 'N/A') 
    };
    
    // تحديد اللغة
    const lang = (data.currentLang && ['ar', 'fr', 'en'].includes(data.currentLang)) ? data.currentLang : 'fr';
    const t = telegramTranslations[lang];

    // --- نهاية التعديل ---


    // --- المهمة الأولى: حفظ البيانات في Google Sheets ---
    await authGoogleSheets(); 
    
    let sheet = doc.sheetsByTitle["Leads"]; 
    if (!sheet) {
        sheet = await doc.addSheet({ title: "Leads" });
    }

    // --- [تعديل جذري]: إضافة الأعمدة الجديدة ---
    const headers = [
      "Timestamp", "Payment Status", "Transaction ID", "Inquiry ID", 
      "Full Name", "Email", "Phone Number", 
      "Selected Course", "Qualification", "Experience",
      "Payment Method", "CashPlus Code", "Amount", "Currency", "Card Last Four",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
    ];
    // --- نهاية التعديل ---

    await sheet.loadHeaderRow(); 

    if (sheet.headerValues.length === 0) {
        await sheet.setHeaderRow(headers);
    }
    
    // --- [تعديل جذري]: إضافة البيانات الجديدة ---
    await sheet.addRow({
      "Timestamp": normalizedData.timestamp,
      "Payment Status": normalizedData.paymentStatus, 
      "Transaction ID": normalizedData.transactionId,
      "Inquiry ID": normalizedData.inquiryId,
      "Full Name": normalizedData.clientName,
      "Email": normalizedData.clientEmail,
      "Phone Number": normalizedData.clientPhone,
      "Selected Course": normalizedData.selectedCourse,
      "Qualification": normalizedData.qualification,
      "Experience": normalizedData.experience,
      "Payment Method": normalizedData.paymentMethod,
      "CashPlus Code": normalizedData.cashplusCode,
      "Amount": normalizedData.amount,
      "Currency": normalizedData.currency,
      "Card Last Four": normalizedData.cardLastFour,
      "utm_source": normalizedData.utm_source,
      "utm_medium": normalizedData.utm_medium,
      "utm_campaign": normalizedData.utm_campaign,
      "utm_term": normalizedData.utm_term, 
      "utm_content": normalizedData.utm_content,
    });
    // --- نهاية التعديل ---

    // --- المهمة الثانية: إرسال إشعار فوري عبر Telegram ---
    
    // --- [تعديل جذري]: بناء الرسالة الجديدة ---
    const title = normalizedData.paymentStatus === 'pending_cashplus' ? t.title_pending : t.title_paid;

    const message = `
${title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(normalizedData.selectedCourse)}
${t.amount} ${sanitizeTelegramHTML(normalizedData.amount)} ${sanitizeTelegramHTML(normalizedData.currency)}
${t.qualification} ${sanitizeTelegramHTML(normalizedData.qualification)}
${t.experience} ${sanitizeTelegramHTML(normalizedData.experience)}
-----------------------------------
${t.name} ${sanitizeTelegramHTML(normalizedData.clientName)}
${t.phone} ${sanitizeTelegramHTML(normalizedData.clientPhone)}
${t.email} ${sanitizeTelegramHTML(normalizedData.clientEmail)}
-----------------------------------
${t.method} ${sanitizeTelegramHTML(normalizedData.paymentMethod)}
${t.cashplus_code} ${sanitizeTelegramHTML(normalizedData.cashplusCode)}
${t.card_last_four} ${sanitizeTelegramHTML(normalizedData.cardLastFour)}
-----------------------------------
${t.req_id} ${sanitizeTelegramHTML(normalizedData.inquiryId)}
${t.status} ${sanitizeTelegramHTML(normalizedData.paymentStatus)}
${t.tx_id} ${sanitizeTelegramHTML(normalizedData.transactionId)}
${t.time} ${sanitizeTelegramHTML(normalizedData.timestamp)}
${t.utm_source} ${sanitizeTelegramHTML(normalizedData.utm_source)}
    `;
    // --- نهاية التعديل ---
    
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

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
