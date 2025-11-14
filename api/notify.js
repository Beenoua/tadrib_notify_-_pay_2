// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import TelegramBot from 'node-telegram-bot-api';
// ... (imports)
import { GoogleSpreadsheet } from 'google-spreadsheet';

// ... (إعدادات الأمان)
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 3. تهيئة الخدمات
let doc; 

// --- [تحديث] ترجمات التيليغرام (استخدام HTML) ---
const telegramTranslations = {
  ar: {
    title: "✅ <b>حجز جديد (Tadrib.ma)</b>", 
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
    method: "<b>طريقة الدفع:</b>",
    code: "<b>كود كاش بلوس:</b>",
    card: "<b>آخر أرقام البطاقة:</b>",
    amount: "<b>المبلغ:</b>",
    currency: "<b>العملة:</b>",
    lang: "<b>اللغة:</b>"
  },
  fr: {
    title: "✅ <b>Nouvelle Réservation (Tadrib.ma)</b>", 
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
    method: "<b>Méthode:</b>",
    code: "<b>Code CashPlus:</b>",
    card: "<b>4 derniers chiffres:</b>",
    amount: "<b>Montant:</b>",
    currency: "<b>Devise:</b>",
    lang: "<b>Lang:</b>"
  },
  en: {
    title: "✅ <b>New Paid Booking (Tadrib.ma)</b> 💳",
    course: "<b>Training:</b>",
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
    code: "<b>CashPlus Code:</b>",
    card: "<b>Last 4 digits:</b>",
    amount: "<b>Amount:</b>",
    currency: "<b>Currency:</b>",
    lang: "<b>Lang:</b>"
  }
};
// --- نهاية التحديث ---

// ... (دالة sanitizeTelegramHTML)
function sanitizeTelegramHTML(text) {
  if (typeof text !== 'string' && typeof text !== 'number') {
    return text;
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


// ... (دالة authGoogleSheets)
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
  
  // ... (إعدادات CORS) ...
  // ... (التحقق من OPTIONS و POST) ...

  let bot; 
  let normalizedData = {}; // كائن موحد لجمع كل البيانات

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN); 
    const data = req.body; 
    
    // [تحديث] العناوين الكاملة (21 عمود)
    const allHeaders = [
      "Timestamp", "Inquiry ID", "Full Name", "Email", "Phone Number", 
      "Selected Course", "Qualification", "Experience", 
      "Payment Status", "Transaction ID", 
      "Payment Method", "CashPlus Code", "Last 4 Digits",
      "Amount", "Currency", "Lang",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
    ];
    
    // التحقق هل هو Webhook حقيقي (يحتوي على payload)؟
    const isWebhook = data.metadata && data.metadata.payload;

    if (isWebhook) {
        // --- سيناريو 1: Webhook قادم من YouCan Pay (دفع ناجح) ---
        console.log("[Notify] Webhook received from YouCan Pay.");
        const payload = JSON.parse(data.metadata.payload);

        // استخراج آخر 4 أرقام (إذا كانت بطاقة)
        let last4 = 'N/A';
        try {
            if (payload.paymentMethod === 'credit_card') {
                 if(data.transaction && data.transaction.data && data.transaction.data.card) {
                    last4 = data.transaction.data.card.last4 || '****';
                 } else if (data.card) { // هيكل احتياطي
                    last4 = data.card.last4 || '****';
                 } else {
                    last4 = '****'; // مدفوع بالبطاقة ولكن لم نجد الرقم
                 }
            }
        } catch (e) { console.warn("Could not parse last 4 digits", e); }

        normalizedData = {
            "Timestamp": new Date().toLocaleString('fr-CA'),
            "Inquiry ID": payload.inquiryId || data.order_id,
            "Full Name": payload.clientName || data.customer.name,
            "Email": payload.clientEmail || data.customer.email,
            "Phone Number": payload.clientPhone || data.customer.phone,
            "Selected Course": payload.course, // [إصلاح]
            "Qualification": payload.qualification, // [إصلاح]
            "Experience": payload.experience, // [إصلاح]
            "Payment Status": (data.status === 1 || data.status === 'paid') ? 'paid' : data.status,
            "Transaction ID": data.id || data.transaction_id,
            "Payment Method": payload.paymentMethod,
            "CashPlus Code": 'N/A', 
            "Last 4 Digits": last4,
            "Amount": data.amount ? data.amount / 100 : 'N/A', 
            "Currency": data.currency || 'MAD',
            "Lang": payload.lang,
            "utm_source": payload.utm_source,
            "utm_medium": payload.utm_medium,
            "utm_campaign": payload.utm_campaign,
            "utm_term": payload.utm_term,
            "utm_content": payload.utm_content
        };

    } else {
        // --- سيناريو 2: إشعار يدوي من الواجهة (Pending CashPlus أو محاكاة) ---
        console.log("[Notify] Manual notification received (Pending or Sandbox).");
        normalizedData = {
            "Timestamp": data.timestamp || new Date().toLocaleString('fr-CA'),
            "Inquiry ID": data.inquiryId,
            "Full Name": data.clientName,
            "Email": data.clientEmail,
            "Phone Number": data.clientPhone,
            "Selected Course": data.course, // [إصلاح]
            "Qualification": data.qualification, // [إصلاح]
            "Experience": data.experience, // [إصلاح]
            "Payment Status": data.paymentStatus || 'pending',
            "Transaction ID": data.transactionId || 'N/A',
            "Payment Method": data.paymentMethod,
            "CashPlus Code": data.cashPlusCode || 'N/A',
            "Last 4 Digits": 'N/A',
            "Amount": data.amount || 'N/A', 
            "Currency": data.currency || 'N/A',
            "Lang": data.lang, // [إصلاح]
            "utm_source": data.utm_source,
            "utm_medium": data.utm_medium,
            "utm_campaign": data.utm_campaign,
            "utm_term": data.utm_term,
            "utm_content": data.utm_content
        };
    }

    // --- المهمة الأولى: حفظ البيانات في Google Sheets ---
    await authGoogleSheets(); 
    let sheet = doc.sheetsByTitle["Leads"]; 
    if (!sheet) {
        sheet = await doc.addSheet({ title: "Leads", headerValues: allHeaders });
    } else {
        // التأكد من أن العناوين محدثة
        await sheet.loadHeaderRow();
        if (sheet.headerValues.join() !== allHeaders.join()) {
            console.log("[Notify] Updating Google Sheet headers...");
            await sheet.setHeaderRow(allHeaders);
        }
    }
    
    // إضافة الصف بالبيانات الموحدة
    await sheet.addRow(normalizedData); 

    // --- المهمة الثانية: إرسال إشعار فوري عبر Telegram ---
    const lang = (normalizedData.Lang && ['ar', 'fr', 'en'].includes(normalizedData.Lang)) ? normalizedData.Lang : 'fr';
    const t = telegramTranslations[lang];

    // [إصلاح] استخدام مفاتيح الكائن الصحيحة (التي تحتوي على مسافات)
    const message = `
${t.title}
-----------------------------------
${t.course} ${sanitizeTelegramHTML(normalizedData["Selected Course"])}
${t.qualification} ${sanitizeTelegramHTML(normalizedData["Qualification"])}
${t.experience} ${sanitizeTelegramHTML(normalizedData["Experience"])}
-----------------------------------
${t.name} ${sanitizeTelegramHTML(normalizedData["Full Name"])}
${t.phone} ${sanitizeTelegramHTML(normalizedData["Phone Number"])}
${t.email} ${sanitizeTelegramHTML(normalizedData["Email"])}
-----------------------------------
${t.status} <b>${sanitizeTelegramHTML(normalizedData["Payment Status"])}</b>
${t.amount} ${sanitizeTelegramHTML(normalizedData["Amount"])} ${sanitizeTelegramHTML(normalizedData["Currency"])}
${t.method} ${sanitizeTelegramHTML(normalizedData["Payment Method"])}
${t.code} ${sanitizeTelegramHTML(normalizedData["CashPlus Code"])}
${t.card} ${sanitizeTelegramHTML(normalizedData["Last 4 Digits"])}
-----------------------------------
${t.req_id} ${sanitizeTelegramHTML(normalizedData["Inquiry ID"])}
${t.tx_id} ${sanitizeTelegramHTML(normalizedData["Transaction ID"])}
${t.time} ${sanitizeTelegramHTML(normalizedData["Timestamp"])}
    `;
    
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    res.status(200).json({ result: 'success', message: 'Data saved and notification sent.' });

  } catch (error) {
    console.error('Error in notify.js:', error.message, error.stack);
    
    try {
      if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
      }
      await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ حدث خطأ فادح في نظام الإشعارات:\n${error.message}`);
    } catch (telegramError) {
      console.error('CRITICAL: Failed to send error to Telegram:', telegramError);
    }
    
    res.status(500).json({ result: 'error', message: 'Internal Server Error' });
  }
};
