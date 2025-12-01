// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import crypto from 'crypto'; // [حل المشكلة 1]: استيراد مكتبة التشفير

// 2. إعدادات الأمان (يتم قراءتها من متغيرات البيئة)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// [حل المشكلة 1]: جلب المفتاح السري للتحقق من التوقيع
const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;

// 3. تهيئة الخدمات
let doc;
let bot; 

// --- [تصحيح]: كائن الترجمات الكامل لجميع اللغات والحقول ---
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
    payment_method: "<b>طريقة الدفع:</b>",
    tx_id: "<b>معرف العملية (TID):</b>",
    cashplus_code: "<b>كود كاش بلوس:</b>",
    req_id: "<b>معرف الطلب:</b>"
  },
  fr: {
    title: "✅ <b>Nouvelle Réservation Payée (Tadrib.ma)</b> 💳",
    course: "<b>Formation:</b>",
    qualification: "<b>Qualification:</b>",
    experience: "<b>Expérience:</b>",
    name: "<b>Nom:</b>",
    phone: "<b>Téléphone:</b>",
    email: "<b>Email:</b>",
    time: "<b>Heure:</b>",
    status: "<b>Statut:</b>",
    payment_method: "<b>Méthode:</b>",
    tx_id: "<b>ID Transaction (TID):</b>",
    cashplus_code: "<b>Code CashPlus:</b>",
    req_id: "<b>ID Demande:</b>"
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
    payment_method: "<b>Method:</b>",
    tx_id: "<b>Transaction ID (TID):</b>",
    cashplus_code: "<b>CashPlus Code:</b>",
    req_id: "<b>Request ID:</b>"
  }
};
// --- [نهاية التصحيح] ---

/**
 * دالة المصادقة مع Google Sheets
 */
async function initGoogleSheet() {
  if (doc) return doc; 

  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

/**
 * دالة تهيئة وإرسال رسالة تيليغرام
 */
async function sendTelegramNotification(data, lang) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram ENVs not set. Skipping notification.');
    return;
  }

  try {
    if (!bot) {
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    }

    // [حل المشكلة 3]: استخدام اللغة الممررة من metadata
    const t = telegramTranslations[lang] || telegramTranslations['fr'];

    // بناء الرسالة لتشمل كل البيانات الجديدة
    const message = `
${t.title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(data.course_name)}
${t.qualification} ${sanitizeTelegramHTML(data.qualification)}
${t.experience} ${sanitizeTelegramHTML(data.experience)}
-----------------------------------
${t.name} ${sanitizeTelegramHTML(data.client_name)}
${t.phone} ${sanitizeTelegramHTML(data.client_phone)}
${t.email} ${sanitizeTelegramHTML(data.client_email)}
-----------------------------------
${t.status} <b>${sanitizeTelegramHTML(data.status)}</b>
${t.payment_method} ${sanitizeTelegramHTML(data.payment_method)}
${data.transactionId ? `${t.tx_id} <code>${sanitizeTelegramHTML(data.transactionId)}</code>` : ''}
${data.cashplusCode ? `${t.cashplus_code} <code>${sanitizeTelegramHTML(data.cashplusCode)}</code>` : ''}
-----------------------------------
${t.req_id} ${sanitizeTelegramHTML(data.inquiry_id)}
${t.time} ${new Date(data.timestamp).toLocaleString('fr-CA')}
    `;

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
    // [حل المشكلة 4]: إرسال خطأ بسيط إذا فشل الإرسال المعقد
    // يتم استدعاء هذا الآن من كتلة catch الرئيسية
    await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ في إرسال إشعار الدفع للطلب: ${data.inquiry_id}\nالبيانات: ${JSON.stringify(data)}`);
  }
}

// --- [تصحيح]: استخدام دالة التنظيف الآمنة ---
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
 * الدالة الرئيسية التي تستقبل الـ Webhook
 */
export default async (req, res) => {
  // السماح بالطلبات (CORS) - هذا ليس ضرورياً لـ webhook ولكنه لا يضر
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-YouCan-Signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // --- [حل المشكلة 1]: التحقق من توقيع الـ Webhook ---
  try {
    if (!YOUCAN_PRIVATE_KEY) {
        throw new Error('YOUCAN_PRIVATE_KEY is not set on server.');
    }
    
    const signature = req.headers['x-youcan-signature'];
    const body = JSON.stringify(req.body); // استخدام النص الخام

    const computedSignature = crypto
        .createHmac('sha256', YOUCAN_PRIVATE_KEY)
        .update(body)
        .digest('hex');

    if (signature !== computedSignature) {
        console.warn('Invalid Webhook Signature. Request rejected.');
        return res.status(401).send('Invalid signature');
    }
  } catch (error) {
      console.error('Signature verification error:', error.message);
      return res.status(500).send('Error during signature verification');
  }
  // --- [نهاية حل المشكلة 1] ---


  let payload;
  let metadata;
  let statusText;
  let transactionId = '';
  let cashplusCode = '';
  let paymentMethod = 'Unknown';
  let lang = 'fr'; // الافتراضي
  const timestamp = new Date().toISOString();

  try {
    payload = req.body;

    // 1. التحقق من الحدث
    if (payload.event_name !== 'payment.succeeded') {
      return res.status(200).send('Event ignored (not payment.succeeded)');
    }

    // 2. استخراج البيانات من Metadata
    metadata = payload.data?.metadata;
    if (!metadata || !metadata.inquiry_id) {
      console.warn('Webhook received without metadata or inquiry_id');
      return res.status(400).send('Missing metadata');
    }

    // 3. استخراج بيانات الدفع الإضافية
    paymentMethod = metadata.payment_method || 'Unknown';
    if (paymentMethod === 'Credit Card' && payload.data?.transaction_id) {
        transactionId = payload.data.transaction_id;
    } else if (paymentMethod === 'CashPlus' && payload.data?.cashplus_code) {
        cashplusCode = payload.data.cashplus_code; 
    }

    // [حل مشكلة Sandbox]: تحديد الحالة بناءً على الوضع
    const currentMode = metadata.mode || 'live'; 
    statusText = (currentMode === 'sandbox') ? 'Sandbox' : 'Paid';
    
    // [حل المشكلة 3]: تحديد اللغة
    lang = metadata.lang || 'fr';

    // 4. الاتصال بـ Google Sheets
    const doc = await initGoogleSheet();
    const sheet = doc.sheetsByTitle['Leads']; 
    if (!sheet) {
        throw new Error("Google Sheet 'Leads' not found.");
    }

    // 5. تجهيز "الصف الجديد"
    const newRow = {
      // الأعمدة الأساسية
      "Timestamp": timestamp,
      "Inquiry ID": metadata.inquiry_id || '',
      "Full Name": metadata.client_name || '',
      "Email": metadata.client_email || '',
      "Phone Number": metadata.client_phone || '',
      "Selected Course": metadata.course_name || '',
      "Qualification": metadata.qualification || '',
      "Experience": metadata.experience || '',
      
      // أعمدة UTM
      "utm_source": metadata.utm_source || '',
      "utm_medium": metadata.utm_medium || '',
      "utm_campaign": metadata.utm_campaign || '',
      "utm_term": metadata.utm_term || '',
      "utm_content": metadata.utm_content || '',
      
      // الأعمدة الجديدة
      "Status": statusText, // (يستخدم 'Paid' أو 'Sandbox')
      "Payment Method": paymentMethod,
      "Transaction ID": transactionId,
      "CashPlus Code": cashplusCode
    };

    // 5. إضافة الصف إلى Google Sheets
    await sheet.addRow(newRow);

    // 6. إرسال إشعار التيليغرام (فقط إذا نجحت الكتابة)
    const reportData = {
        ...metadata,
        status: statusText,
        transactionId: transactionId,
        cashplusCode: cashplusCode,
        timestamp: timestamp
    };
    
    await sendTelegramNotification(reportData, lang);

    console.log(`Successfully added paid record for inquiry: ${metadata.inquiry_id}`);
    res.status(200).send('Webhook processed successfully: Row created');

  } catch (error) {
    console.error('Webhook Error:', error.message);
    
    // [حل المشكلة 4]: إرسال إشعار خطأ (يتضمن بيانات العميل)
    try {
      const errorData = metadata || { inquiry_id: 'Unknown', client_name: 'Unknown' };
      await sendTelegramNotification({
          ...errorData,
          status: `ERROR_SHEETS_FAILED: ${error.message}`,
          transactionId: transactionId,
          cashplusCode: cashplusCode,
          timestamp: timestamp
      }, lang);
    } catch (telegramError) {
        console.error('Failed to send error message to Telegram:', telegramError.message);
    }
    
    res.status(500).send('Internal Server Error (but Telegram notified)');
  }
};
