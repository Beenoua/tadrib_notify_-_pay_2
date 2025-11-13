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

// --- [إعادة بناء]: ترجمات التيليغرام الشاملة ---
const telegramTranslations = {
  ar: {
    title_paid: "✅ <b>حجز مدفوع جديد (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>حجز معلق (CashPlus)</b> ⏳", 
    title_failed: "❌ <b>فشل عملية دفع (Tadrib.ma)</b> ❌",
    // بيانات الحجز
    course: "<b>الدورة:</b>",
    qualification: "<b>المؤهل:</b>",
    experience: "<b>الخبرة:</b>",
    name: "<b>الاسم:</b>",
    phone: "<b>الهاتف:</b>",
    email: "<b>الإيميل:</b>",
    // بيانات الدفع
    amount: "<b>المبلغ:</b>",
    method: "<b>طريقة الدفع:</b>",
    cashplus_code: "<b>كود كاش بلوس:</b>",
    card_last_four: "<b>آخر 4 أرقام:</b>",
    fees: "<b>رسوم البوابة:</b>",
    // بيانات التتبع
    status: "<b>الحالة:</b>", 
    tx_id: "<b>رقم المعاملة:</b>",
    req_id: "<b>معرف الطلب:</b>",
    time: "<b>الوقت:</b>",
    utm_source: "<b>المصدر (UTM):</b>",
    utm_medium: "<b>الوسيط (UTM):</b>",
    utm_campaign: "<b>الحملة (UTM):</b>",
    error_message: "<b>رسالة الخطأ:</b>"
  },
  fr: {
    title_paid: "✅ <b>Nouvelle Réservation Payée (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>Réservation en attente (CashPlus)</b> ⏳",
    title_failed: "❌ <b>Échec de Paiement (Tadrib.ma)</b> ❌",
    // بيانات الحجز
    course: "<b>Formation:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Expérience:</b>",
    name: "<b>Nom:</b>",
    phone: "<b>Téléphone:</b>",
    email: "<b>E-mail:</b>",
    // بيانات الدفع
    amount: "<b>Montant:</b>",
    method: "<b>Méthode:</b>",
    cashplus_code: "<b>Code CashPlus:</b>",
    card_last_four: "<b>4 derniers chiffres:</b>",
    fees: "<b>Frais de passerelle:</b>",
    // بيانات التتبع
    status: "<b>Statut:</b>", 
    tx_id: "<b>ID Transaction:</b>",
    req_id: "<b>ID de requête:</b>",
    time: "<b>Heure:</b>",
    utm_source: "<b>Source (UTM):</b>",
    utm_medium: "<b>Medium (UTM):</b>",
    utm_campaign: "<b>Campagne (UTM):</b>",
    error_message: "<b>Message d'erreur:</b>"
  },
  // (يمكن إضافة الإنجليزية لاحقاً بنفس الطريقة)
};
// --- [نهاية إعادة البناء] ---

/**
 * دالة تنظيف لـ HTML
 */
function sanitizeTelegramHTML(text) {
  if (typeof text !== 'string' && typeof text !== 'number') {
    return text;
  }
  return String(text)
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
  let lang = 'fr'; // لغة افتراضية للإشعارات

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN); 
    const data = req.body; 
    
    // --- [إعادة بناء]: منطق توحيد البيانات (Webhook أو Manual) ---

    // (isWebhook = true) إذا كان الطلب من خادم YouCanPay (يحتوي على payload و metadata)
    const isWebhook = !!(data.payload && data.metadata && data.event_name); 
    // (isManualSend = true) إذا كان الطلب يدوياً من script-cleaned-2.js (مثل pending_cashplus)
    const isManualSend = !!(data.paymentStatus && data.paymentStatus === 'pending_cashplus');

    let normalizedData = {};
    let t = telegramTranslations[lang]; // التحميل المبدئي

    if (isWebhook) {
        // --- المصدر 1: Webhook آلي (للبطاقة البنكية وكاش بلوس المدفوع) ---
        const payload = data.payload || {};
        const transaction = payload.transaction || {};
        const metadata = data.metadata || {};
        lang = (metadata.currentLang && ['ar', 'fr', 'en'].includes(metadata.currentLang)) ? metadata.currentLang : 'fr';
        t = telegramTranslations[lang];

        normalizedData = {
          // بيانات الحجز (من Metadata التي حقناها)
          timestamp: new Date().toLocaleString('fr-CA'),
          inquiryId: metadata.inquiryId || payload.order_id || 'N/A',
          clientName: metadata.clientName || 'N/A',
          clientEmail: metadata.clientEmail || 'N/A',
          clientPhone: metadata.clientPhone || 'N/A',
          selectedCourse: metadata.selectedCourse || 'N/A',
          qualification: metadata.qualification || 'N/A',
          experience: metadata.experience || 'N/A',
          
          // بيانات الدفع (من الـ Webhook)
          paymentStatus: data.event_name || transaction.status || 'N/A', // مثل "transaction.success"
          transactionId: transaction.id || 'N/A',
          paymentMethod: metadata.paymentMethod || 'N/A', // (credit_card أو cashplus)
          cashplusCode: 'N/A', // الـ Webhook لا يرسله
          amount: (payload.amount / 100) || metadata.amount || 'N/A', // Webhook يرسل بالسنتيم
          currency: payload.currency || metadata.currency || 'MAD',
          cardLastFour: payload.card_last_four || 'N/A',
          gatewayFees: payload.fees || 'N/A',
          errorMessage: payload.message || (data.event_name === 'transaction.failed' ? 'Failed' : 'N/A'),

          // بيانات التتبع (من Metadata)
          utm_source: metadata.utm_source || '',
          utm_medium: metadata.utm_medium || '',
          utm_campaign: metadata.utm_campaign || '',
          utm_term: metadata.utm_term || '',
          utm_content: metadata.utm_content || ''
        };

    } else if (isManualSend) {
        // --- المصدر 2: إشعار يدوي (فقط لـ Pending CashPlus) ---
        lang = (data.currentLang && ['ar', 'fr', 'en'].includes(data.currentLang)) ? data.currentLang : 'fr';
        t = telegramTranslations[lang];

        normalizedData = {
          // بيانات الحجز (من الإشعار اليدوي)
          timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
          inquiryId: data.inquiryId,
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          clientPhone: data.clientPhone,
          selectedCourse: data.selectedCourse,
          qualification: data.qualification,
          experience: data.experience,
          
          // بيانات الدفع (من الإشعار اليدوي)
          paymentStatus: data.paymentStatus, // 'pending_cashplus'
          transactionId: 'N/A',
          paymentMethod: data.paymentMethod || 'CashPlus',
          cashplusCode: data.cashplusCode || 'N/A', // <-- [الأهم]
          amount: data.amount || 'N/A',
          currency: data.currency || 'MAD',
          cardLastFour: 'N/A',
          gatewayFees: 'N/A',
          errorMessage: 'N/A',

          // بيانات التتبع (من الإشعار اليدوي)
          utm_source: data.utm_source || '',
          utm_medium: data.utm_medium || '',
          utm_campaign: data.utm_campaign || '',
          utm_term: data.utm_term || '',
          utm_content: data.utm_content || ''
        };
    } else {
        // إذا لم يكن أي منهما، تجاهل الطلب
        console.warn('Received unknown payload structure:', data);
        return res.status(400).json({ result: 'error', message: 'Unknown payload structure.' });
    }
    
    // --- نهاية إعادة البناء ---


    // --- المهمة الأولى: حفظ البيانات في Google Sheets ---
    await authGoogleSheets(); 
    
    let sheet = doc.sheetsByTitle["Leads"]; 
    if (!sheet) {
        sheet = await doc.addSheet({ title: "Leads" });
    }

    // --- [إعادة بناء]: الأعمدة الشاملة ---
    // (مطابقة للتي طلبتها + الإضافات من بوابة الدفع)
    const HEADERS = [
      "Timestamp", "Inquiry ID", "Payment Status", "Transaction ID", 
      "Full Name", "Email", "Phone Number", 
      "Selected Course", "Qualification", "Experience",
      "Payment Method", "CashPlus Code", 
      "Amount", "Currency", "Card Last Four", "Gateway Fees", "Error Message",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
    ];
    // --- نهاية إعادة البناء ---

    await sheet.loadHeaderRow(); 

    if (sheet.headerValues.length === 0) {
        await sheet.setHeaderRow(HEADERS);
    }
    
    // --- [إعادة بناء]: إضافة السطر الشامل ---
    await sheet.addRow({
      "Timestamp": normalizedData.timestamp,
      "Inquiry ID": normalizedData.inquiryId,
      "Payment Status": normalizedData.paymentStatus, 
      "Transaction ID": normalizedData.transactionId,
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
      "Gateway Fees": normalizedData.gatewayFees,
      "Error Message": normalizedData.errorMessage,
      "utm_source": normalizedData.utm_source,
      "utm_medium": normalizedData.utm_medium,
      "utm_campaign": normalizedData.utm_campaign,
      "utm_term": normalizedData.utm_term, 
      "utm_content": normalizedData.utm_content,
    });
    // --- نهاية إعادة البناء ---

    // --- المهمة الثانية: إرسال إشعار فوري عبر Telegram ---
    
    // --- [إعادة بناء]: بناء الرسالة الشاملة ---
    let title;
    if (normalizedData.paymentStatus === 'pending_cashplus') {
        title = t.title_pending;
    } else if (normalizedData.paymentStatus.includes('success') || normalizedData.paymentStatus.toString() === '1') {
        title = t.title_paid;
    } else {
        title = t.title_failed;
    }

    // بناء رسالة ديناميكية (فقط الحقول الموجودة)
    let message = `${title}\n-----------------------------------\n`;
    
    // (دالة مساعدة لإضافة سطر إذا كانت القيمة موجودة وليست 'N/A')
    const addLine = (key, value) => {
        if (value && value !== 'N/A' && value !== '') {
            message += `${sanitizeTelegramHTML(t[key])} ${sanitizeTelegramHTML(value)}\n`;
        }
    };

    addLine('name', normalizedData.clientName);
    addLine('phone', normalizedData.clientPhone);
    addLine('email', normalizedData.clientEmail);
    message += `-----------------------------------\n`;
    addLine('course', normalizedData.selectedCourse);
    addLine('amount', `${normalizedData.amount} ${normalizedData.currency}`);
    addLine('qualification', normalizedData.qualification);
    addLine('experience', normalizedData.experience);
    message += `-----------------------------------\n`;
    addLine('method', normalizedData.paymentMethod);
    addLine('cashplus_code', normalizedData.cashplusCode);
    addLine('card_last_four', normalizedData.cardLastFour);
    addLine('fees', normalizedData.gatewayFees);
    message += `-----------------------------------\n`;
    addLine('status', normalizedData.paymentStatus);
    addLine('tx_id', normalizedData.transactionId);
    addLine('req_id', normalizedData.inquiryId);
    addLine('time', normalizedData.timestamp);
    addLine('error_message', normalizedData.errorMessage);
    message += `-----------------------------------\n`;
    addLine('utm_source', normalizedData.utm_source);
    addLine('utm_medium', normalizedData.utm_medium);
    addLine('utm_campaign', normalizedData.utm_campaign);
    // --- نهاية إعادة البناء ---
    
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    res.status(200).json({ result: 'success', message: 'Data saved and notification sent.' });

  } catch (error) {
    console.error('Error in notify.js:', error);
    
    try {
      if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
      }
      const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
      await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ فادح في نظام الإشعارات (notify.js):\n${errorMessage}`);
    } catch (telegramError) {
      console.error('CRITICAL: Failed to send error to Telegram:', telegramError);
    }
    
    res.status(500).json({ result: 'error', message: 'Internal Server Error' });
  }
};
