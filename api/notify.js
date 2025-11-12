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
let bot; // سيتم تهيئة البوت عند الحاجة

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
  if (doc) return doc; // إذا تم تهيئته من قبل

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

    // الافتراضي هو 'fr' إذا كانت اللغة غير مدعومة أو غير موجودة
    const t = telegramTranslations[lang] || telegramTranslations['fr'];

    // بناء الرسالة لتشمل كل البيانات الجديدة
    // استخدام t.tx_id و t.payment_method إلخ. التي تم إصلاحها
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
${t.status} <b>${data.status}</b>
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
    // إرسال خطأ بسيط إذا فشل الإرسال المعقد
    await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ في إرسال إشعار الدفع للطلب: ${data.inquiry_id}`);
  }
}

// --- [تصحيح]: استخدام دالة التنظيف الآمنة التي أشرت إليها ---
/**
 * تنظيف النص لإرساله بأمان في HTML (لـ Telegram)
 * @param {string} text النص المراد تنظيفه
 * @returns {string} نص آمن للإرسال
 */
function sanitizeTelegramHTML(text) {
  if (typeof text !== 'string') {
    return text; // أعد القيمة (مثل رقم أو undefined) كما هي
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// --- [نهاية التصحيح] ---

/**
 * الدالة الرئيسية التي تستقبل الـ Webhook
 */
export default async (req, res) => {
  // السماح بالطلبات (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const payload = req.body;

    // 1. التحقق من الحدث
    if (payload.event_name !== 'payment.succeeded') {
      return res.status(200).send('Event ignored (not payment.succeeded)');
    }

    // 2. استخراج البيانات من Metadata
    const metadata = payload.data?.metadata;
    if (!metadata || !metadata.inquiry_id) {
      console.warn('Webhook received without metadata or inquiry_id');
      return res.status(400).send('Missing metadata');
    }

    // 3. استخراج معرف المحادثة (Transaction ID) وكود كاش بلوس
    let transactionId = '';
    let cashplusCode = '';
    const paymentMethod = metadata.payment_method || 'Unknown';

    if (paymentMethod === 'Credit Card' && payload.data?.transaction_id) {
        transactionId = payload.data.transaction_id;
    } else if (paymentMethod === 'CashPlus' && payload.data?.cashplus_code) {
        cashplusCode = payload.data.cashplus_code; 
    }
    // --- [الإضافة المطلوبة هنا] ---
    // 1. قراءة الوضع (Mode) من الـ metadata
    const currentMode = metadata.mode || 'live'; // الافتراضي 'live' للأمان

    // 2. تحديد نص الحالة (Status) بناءً على طلبك
    const statusText = (currentMode === 'sandbox') ? 'Sandbox' : 'Paid';
    // --- [نهاية الإضافة] ---

    // 4. الاتصال بـ Google Sheets
    const doc = await initGoogleSheet();
    // استخدام اسم الورقة "Leads" كما في كود doPost الذي أرسلته
    const sheet = doc.sheetsByTitle['Leads']; 

    // 5. تجهيز "الصف الجديد" (بناءً على الأعمدة في doPost + الإضافات)
    const timestamp = new Date().toISOString();
    const newRow = {
      // الأعمدة الأساسية من doPost
      "Timestamp": timestamp,
      "Inquiry ID": metadata.inquiry_id || '',
      "Full Name": metadata.client_name || '',
      "Email": metadata.client_email || '',
      "Phone Number": metadata.client_phone || '',
      "Selected Course": metadata.course_name || '',
      "Qualification": metadata.qualification || '',
      "Experience": metadata.experience || '',
      // الأعمدة الجديدة التي طلبتها
      "Status": statusText, // (استبدال "Paid" الثابتة بالمتغير الجديد)
      "Payment Method": paymentMethod,
      "Transaction ID": transactionId,
      "CashPlus Code": cashplusCode,
      
      // أعمدة UTM (إذا تم تمريرها)
      "utm_source": metadata.utm_source || '',
      "utm_medium": metadata.utm_medium || '',
      "utm_campaign": metadata.utm_campaign || '',
      "utm_term": metadata.utm_term || '',
      "utm_content": metadata.utm_content || '',
      
      // الأعمدة الجديدة التي طلبتها
      "Status": "Paid", // الحالة دائماً "Paid"
      "Payment Method": paymentMethod,
      "Transaction ID": transactionId,
      "CashPlus Code": cashplusCode
    };

    // 5. إضافة الصف إلى Google Sheets
    await sheet.addRow(newRow);

    // 6. إرسال إشعار التيليغرام
    const reportData = {
        ...metadata, // يحتوي على كل بيانات العميل (الاسم، الايميل، الخ)
        status: statusText, // (استبدال "Paid" الثابتة)
        transactionId: transactionId,
        cashplusCode: cashplusCode,
        timestamp: timestamp
    };
    
    // محاولة قراءة اللغة من metadata (إذا أضفتها مستقبلاً)
    // إذا لم تكن موجودة، سيستخدم الافتراضي 'fr'
    const lang = metadata.lang || 'fr'; 
    await sendTelegramNotification(reportData, lang);

    console.log(`Successfully added paid record for inquiry: ${metadata.inquiry_id}`);
    res.status(200).send('Webhook processed successfully: Row created');

  } catch (error) {
    console.error('Webhook Error:', error.message);
    // إرسال إشعار خطأ إلى تيليغرام إذا فشل كل شيء
    try {
        if (!bot) bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
        await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ خطأ فادح في Webhook: ${error.message}`);
    } catch (telegramError) {
        console.error('Failed to send error message to Telegram:', telegramError.message);
    }
    res.status(500).send('Internal Server Error');
  }
};
