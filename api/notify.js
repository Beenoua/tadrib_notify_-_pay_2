// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import TelegramBot from 'node-telegram-bot-api';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import axios from 'axios'; // [إضافة] نحتاج axios لجلب تفاصيل المعاملة
import { validateEmail, validatePhone, sanitizeString, validateRequired, normalizePhone, sanitizeTelegramHTML } from './utils.js';

// 2. إعدادات الأمان
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// [إضافة] مفاتيح YouCanPay لجلب التفاصيل
const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;
const YOUCAN_PUBLIC_KEY = process.env.YOUCAN_PUBLIC_KEY;
const YOUCAN_MODE = process.env.YOUCAN_MODE;

// Validate environment variables
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
    let data = req.body; // نستخدم let لأننا سنقوم بتعديل البيانات

    // [DEBUG LOG]
    console.log("Incoming Payload:", JSON.stringify(data).substring(0, 500));

    // [إصلاح جذري]: التعامل مع YouCanPay Webhook المختصر
    // إذا كان الحدث هو "دفع ناجح" ويحتوي على معرّف المعاملة، ولكن ينقصه بيانات العميل
    if (data.event_name === 'transaction.paid' && data.payload && data.payload.transaction && data.payload.transaction.id) {
        
        const transactionId = data.payload.transaction.id;
        console.log(`ℹ️ YouCanPay Lightweight Webhook detected. Fetching full details for ID: ${transactionId}...`);

        try {
            const isSandbox = YOUCAN_MODE === 'sandbox';
            const youcanApiBaseUrl = isSandbox ? 'https://youcanpay.com/sandbox/api' : 'https://youcanpay.com/api';
            
            // طلب التفاصيل الكاملة من YouCanPay
            const response = await axios.get(`${youcanApiBaseUrl}/transactions/${transactionId}`, {
                params: {
                    pri_key: YOUCAN_PRIVATE_KEY,
                    pub_key: YOUCAN_PUBLIC_KEY
                }
            });

            const fullTransaction = response.data.transaction;

            if (fullTransaction) {
                console.log("✅ Full transaction details fetched successfully.");
                
                // دمج البيانات الكاملة في المتغير data لكي يعمل باقي الكود بشكل طبيعي
                // نعيد هيكلة البيانات لتناسب التنسيق الذي يتوقعه الكود في الأسفل
                data.customer = fullTransaction.customer;
                data.metadata = fullTransaction.metadata;
                data.transaction_id = fullTransaction.id;
                data.status = fullTransaction.status === 1 ? 'paid' : 'failed';
                data.amount = fullTransaction.amount / 100; // تحويل من سنتات إلى درهم (إذا لزم الأمر، تحقق من رد YouCan)
                // YouCan أحياناً ترسل المبلغ 180000 بمعنى 1800.00
                
                // فرض أن الطلب هو webhook الآن بعد أن جلبنا البيانات
                data.is_enriched_webhook = true; 
            }
        } catch (fetchError) {
            console.error("❌ Failed to fetch full transaction details:", fetchError.message);
            // إذا فشل الجلب، لا يمكننا فعل الكثير، نرسل 200 لنتوقف عن استقبال التنبيه
            return res.status(200).json({ result: 'ignored', message: 'Could not fetch transaction details' });
        }
    }

    const lang = data.metadata?.lang || data.currentLang || 'fr';
    const t = telegramTranslations[lang] || telegramTranslations['fr'];

    const userAgent = req.headers['user-agent'] || '';
    const isYouCanPay = userAgent.includes('YouCanPay');

    const isWebhook =
    data.is_enriched_webhook ||              // [NEW] تم إثراء البيانات بنجاح
    isYouCanPay ||                           
    data.object === "event" ||               
    data.customer ||                         
    data.metadata?.paymentMethod ||          
    data.payment_method ||                   
    data.transaction_id ||                   
    data.status;                             


    // Validate required fields for webhook
    if (isWebhook) {
      if (!data.customer || !data.metadata) {
          console.warn("⚠️ Webhook received but missing customer/metadata (Ignored).");
          return res.status(200).json({ result: 'ignored', message: 'Non-transactional webhook ignored.' });
      }
      // الآن بعد جلب البيانات، هذه التحققات ستنجح
      validateRequired(data.customer, ['name', 'email', 'phone']);
      validateRequired(data.metadata, ['inquiryId']);
    } else {
      validateRequired(data, ['clientName', 'clientEmail', 'clientPhone', 'inquiryId']);
    }

    // Validate email and phone if provided
    const emailToValidate = isWebhook ? data.customer.email : data.clientEmail;
    const phoneToValidate = isWebhook ? data.customer.phone : data.clientPhone;

    if (emailToValidate && !validateEmail(emailToValidate)) {
      throw new Error('Invalid email format');
    }
    if (phoneToValidate && !validatePhone(phoneToValidate)) {
      throw new Error('Invalid phone number format');
    }
      
    // Determine the raw status
    let rawStatus = isWebhook ? data.status : data.paymentStatus;
    
    // Clean the raw status (robustly)
    if (!rawStatus || typeof rawStatus !== 'string' || rawStatus.trim() === '' || rawStatus.trim().toLowerCase() === 'undefined') {
        rawStatus = 'pending'; 
    }

    // جميع البيانات المهيكلة
    const normalizedData = {
      timestamp: data.timestamp || new Date().toLocaleString('fr-CA'),
      inquiryId: sanitizeString(isWebhook ? data.metadata.inquiryId : data.inquiryId),

      clientName: sanitizeString(isWebhook ? data.customer.name : data.clientName),
      clientEmail: sanitizeString(isWebhook ? data.customer.email : data.clientEmail),
      clientPhone: normalizePhone(isWebhook ? data.customer.phone : data.clientPhone),

      selectedCourse: sanitizeString(isWebhook ? data.metadata.course : data.selectedCourse),
      qualification: sanitizeString(isWebhook ? data.metadata.qualification : data.qualification),
      experience: sanitizeString(isWebhook ? data.metadata.experience : data.experience),

      paymentMethod: sanitizeString(data.payment_method || data.metadata?.paymentMethod || null),
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

      paymentStatus: sanitizeString(rawStatus),
      transactionId: sanitizeString(isWebhook ? data.transaction_id : (data.transactionId || 'N/A'))
    };

    // حفظ في Google Sheets
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

    // رسالة التيليغرام
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
${t.status} ${sanitizeTelegramHTML(normalizedData.paymentStatus)}
${t.tx_id} ${sanitizeTelegramHTML(normalizedData.transactionId)}
${t.time} ${sanitizeTelegramHTML(normalizedData.timestamp)}
    `;

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    res.status(200).json({ result: 'success', message: 'Webhook received and saved.' });

  } catch (error) {
    console.error("Webhook Error:", error.message);

    let clientMessage = "An error occurred while processing the webhook";
    if (error.message.includes('Missing required fields') || error.message.includes('Invalid')) {
      clientMessage = error.message;
    }

    res.status(400).json({ error: "Bad Request", message: clientMessage });
  }
};
