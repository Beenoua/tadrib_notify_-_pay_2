import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';

// --- إعدادات الأمان (يتم قراءتها من متغيرات البيئة) ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let doc; 

// --- [إعادة بناء]: ترجمات التيليغرام الشاملة ---
const telegramTranslations = {
  ar: {
    title_paid: "✅ <b>حجز مدفوع جديد (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>حجز معلق (CashPlus)</b> ⏳", 
    title_failed: "❌ <b>فشل عملية دفع (Tadrib.ma)</b> ❌",
    course: "<b>الدورة:</b>",
    qualification: "<b>المؤهل:</b>",
    experience: "<b>الخبرة:</b>",
    name: "<b>الاسم:</b>",
    phone: "<b>الهاتف:</b>",
    email: "<b>الإيميل:</b>",
    amount: "<b>المبلغ:</b>",
    method: "<b>طريقة الدفع:</b>",
    cashplus_code: "<b>كود كاش بلوس:</b>",
    card_last_four: "<b>آخر 4 أرقام:</b>",
    fees: "<b>رسوم البوابة:</b>",
    status: "<b>الحالة:</b>", 
    tx_id: "<b>رقم المعاملة:</b>",
    req_id: "<b>معرف الطلب:</b>",
    time: "<b>الوقت:</b>",
    utm_source: "<b>المصدر (UTM):</b>",
    utm_medium: "<b>الوسيط (UTM):</b>",
    utm_campaign: "<b>الحملة (UTM):</b>",
    utm_term: "<b>الكلمة (UTM):</b>",
    utm_content: "<b>المحتوى (UTM):</b>",
    error_message: "<b>رسالة الخطأ:</b>"
  },
  fr: {
    title_paid: "✅ <b>Nouvelle Réservation Payée (Tadrib.ma)</b> 💳", 
    title_pending: "⏳ <b>Réservation en attente (CashPlus)</b> ⏳",
    title_failed: "❌ <b>Échec de Paiement (Tadrib.ma)</b> ❌",
    course: "<b>Formation:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Expérience:</b>",
    name: "<b>Nom:</b>",
    phone: "<b>Téléphone:</b>",
    email: "<b>E-mail:</b>",
    amount: "<b>Montant:</b>",
    method: "<b>Méthode:</b>",
    cashplus_code: "<b>Code CashPlus:</b>",
    card_last_four: "<b>4 derniers chiffres:</b>",
    fees: "<b>Frais de passerelle:</b>",
    status: "<b>Statut:</b>", 
    tx_id: "<b>ID Transaction:</b>",
    req_id: "<b>ID de requête:</b>",
    time: "<b>Heure:</b>",
    utm_source: "<b>Source (UTM):</b>",
    utm_medium: "<b>Medium (UTM):</b>",
    utm_campaign: "<b>Campagne (UTM):</b>",
    utm_term: "<b>Terme (UTM):</b>",
    utm_content: "<b>Contenu (UTM):</b>",
    error_message: "<b>Message d'erreur:</b>"
  }
};
// --- [نهاية إعادة البناء] ---

// دالة تنظيف لـ HTML
function sanitizeTelegramHTML(text) {
  if (typeof text !== 'string' && typeof text !== 'number') {
    return text;
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// دالة المصادقة مع Google Sheets
async function authGoogleSheets() {
  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo(); 
}

/**
 * الدالة الرئيسية التي تستقبل الطلبات
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
  let lang = 'fr'; // لغة افتراضية

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN); 
    const data = req.body; 
    
    // --- [إعادة بناء]: منطق توحيد البيانات (Webhook أو Manual) ---
    const isWebhook = !!(data.payload && data.metadata && data.event_name); 
    const isManualSend = !!(data.paymentStatus && data.paymentStatus === 'pending_cashplus');

    let normalizedData = {};
    let t; // --- [الحل لخطأ 'title_pending'] ---: لا تقم بتعريف (t) هنا

    if (isWebhook) {
        // --- المصدر 1: Webhook آلي (للبطاقة البنكية وكاش بلوس المدفوع) ---
        
        // 1. استخراج النص المضغوط من الـ Webhook
        const allDataString = data.metadata.allData || "{}";
        // 2. فك ضغط النص (تحويله إلى كائن)
        const metadata = JSON.parse(allDataString);
        
        const payload = data.payload || {};
        const transaction = payload.transaction || {};
        
        // [الحل لخطأ 'title_pending']: تعريف (t) هنا
        lang = (metadata.currentLang && ['ar', 'fr', 'en'].includes(metadata.currentLang)) ? metadata.currentLang : 'fr';
        t = telegramTranslations[lang];

        normalizedData = {
          timestamp: new Date().toLocaleString('fr-CA'),
          inquiryId: metadata.inquiryId || payload.order_id || 'N/A',
          clientName: metadata.clientName || 'N/A',
          clientEmail: metadata.clientEmail || 'N/A',
          clientPhone: metadata.clientPhone || 'N/A',
          selectedCourse: metadata.selectedCourse || 'N/A',
          qualification: metadata.qualification || 'N/A',
          experience: metadata.experience || 'N/A',
          paymentStatus: data.event_name || transaction.status || 'N/A', 
          transactionId: transaction.id || 'N/A',
          paymentMethod: metadata.paymentMethod || 'N/A', 
          cashplusCode: 'N/A', // الـ Webhook لا يرسله
          amount: (payload.amount / 100) || metadata.amount || 'N/A', 
          currency: payload.currency || metadata.currency || 'MAD',
          cardLastFour: payload.card_last_four || 'N/A',
          gatewayFees: payload.fees || 'N/A',
          errorMessage: payload.message || (data.event_name === 'transaction.failed' ? 'Failed' : 'N/A'),
          utm_source: metadata.utm_source || '',
          utm_medium: metadata.utm_medium || '',
          utm_campaign: metadata.utm_campaign || '',
          utm_term: metadata.utm_term || '',
          utm_content: metadata.utm_content || ''
        };

    } else if (isManualSend) {
        // --- المصدر 2: إشعار يدوي (فقط لـ Pending CashPlus) ---
        
        // [الحل لخطأ 'title_pending']: تعريف (t) هنا
        lang = (data.currentLang && ['ar', 'fr', 'en'].includes(data.currentLang)) ? data.currentLang : 'fr';
        t = telegramTranslations[lang];

        normalizedData = {
          timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
          inquiryId: data.inquiryId,
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          clientPhone: data.clientPhone,
          selectedCourse: data.selectedCourse,
          qualification: data.qualification,
          experience: data.experience,
          paymentStatus: data.paymentStatus, // 'pending_cashplus'
          transactionId: 'N/A',
          paymentMethod: data.paymentMethod || 'CashPlus',
          cashplusCode: data.cashplusCode || 'N/A', // <-- [الأهم]
          amount: data.amount || 'N/A',
          currency: data.currency || 'MAD',
          cardLastFour: 'N/A',
          gatewayFees: 'N/A',
          errorMessage: 'N/A',
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

    // --- المهمة 1: حفظ البيانات في Google Sheets ---
    await authGoogleSheets(); 
    let sheet = doc.sheetsByTitle["Leads"]; 
    if (!sheet) {
        sheet = await doc.addSheet({ title: "Leads" });
    }

    // --- [إعادة بناء]: الأعمدة الشاملة (حسب طلبك) ---
    const HEADERS = [
      "Timestamp", "Inquiry ID", "Full Name", "Email", "Phone Number", 
      "Selected Course", "Qualification", "Experience",
      "Payment Status", "Transaction ID", "Payment Method", "CashPlus Code",
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
      "Full Name": normalizedData.clientName,
      "Email": normalizedData.clientEmail,
      "Phone Number": normalizedData.clientPhone,
      "Selected Course": normalizedData.selectedCourse,
      "Qualification": normalizedData.qualification,
      "Experience": normalizedData.experience,
      "Payment Status": normalizedData.paymentStatus, 
      "Transaction ID": normalizedData.transactionId,
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

    // --- المهمة 2: إرسال إشعار فوري عبر Telegram ---
    
    // [الحل لخطأ 'title_pending']: (t) الآن مُعرفة دائماً
    let title;
    if (normalizedData.paymentStatus === 'pending_cashplus') {
        title = t.title_pending;
    } else if (normalizedData.paymentStatus.includes('success') || normalizedData.paymentStatus.toString() === '1') {
        title = t.title_paid;
    } else {
        title = t.title_failed;
    }

    let message = `${title}\n-----------------------------------\n`;
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
    addLine('utm_term', normalizedData.utm_term);
    addLine('utm_content', normalizedData.utm_content);
    
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
