// --- ملف جديد: إرسال كود الدفع عبر Brevo (بريد إلكتروني) ---
// --- تأكد من تثبيت الحزمة: npm install sib-api-v3-sdk ---
import SibApiV3Sdk from 'sib-api-v3-sdk';

// 1. قراءة إعدادات Brevo من متغيرات البيئة
const BREVO_API_KEY = process.env.BREVO_API_KEY; // المفتاح الذي تستخدمه مسبقاً
const EMAIL_SENDER_ADDRESS = process.env.EMAIL_SENDER_ADDRESS; // الإيميل الذي سترسل منه (يجب أن يكون مُفعّلاً في Brevo)
const EMAIL_SENDER_NAME = "Tadrib.ma"; // اسم المرسل

// 2. إعدادات الدورات (لحساب السعر)
const courseData = {
    pmp: { originalPrice: 2800 },
    planning: { originalPrice: 2800 },
    qse: { originalPrice: 2450 },
    softskills: { originalPrice: 1700 },
    other: { originalPrice: 199 }
};
const discountPercentage = 35;

// 3. ترجمات رسائل البريد الإلكتروني
const emailTranslations = {
  ar: {
    subject: "كود الدفع كاش بلوس الخاص بك | Tadrib.ma",
    body: (code, price) => `
      <p>مرحباً،</p>
      <p>شكراً لاهتمامك بالانضمام إلى Tadrib.ma.</p>
      <p>لاستكمال حجزك، يرجى استخدام كود الدفع التالي لدى أقرب وكالة كاش بلوس:</p>
      <h2 style="font-size: 24px; color: #1E3A8A; margin: 15px 0;">${code}</h2>
      <p>المبلغ الإجمالي للدفع هو: <b>${price} درهم</b>.</p>
      <p>شكراً لك.</p>
    `
  },
  fr: {
    subject: "Votre code de paiement CashPlus | Tadrib.ma",
    body: (code, price) => `
      <p>Bonjour,</p>
      <p>Merci de votre intérêt pour Tadrib.ma.</p>
      <p>Pour finaliser votre réservation, veuillez utiliser le code de paiement suivant auprès de l'agence CashPlus la plus proche :</p>
      <h2 style="font-size: 24px; color: #1E3A8A; margin: 15px 0;">${code}</h2>
      <p>Le montant total à payer est de : <b>${price} DH</b>.</p>
      <p>Merci.</p>
    `
  },
  en: {
    subject: "Your CashPlus Payment Code | Tadrib.ma",
    body: (code, price) => `
      <p>Hello,</p>
      <p>Thank you for your interest in Tadrib.ma.</p>
      <p>To finalize your booking, please use the following payment code at the nearest CashPlus agency:</p>
      <h2 style="font-size: 24px; color: #1E3A8A; margin: 15px 0;">${code}</h2>
      <p>The total amount to pay is: <b>${price} MAD</b>.</p>
      <p>Thank you.</p>
    `
  }
};

// 4. تهيئة عميل Brevo
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// 5. الدالة الرئيسية للخادم
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

  // التحقق من الإعدادات
  if (!BREVO_API_KEY || !EMAIL_SENDER_ADDRESS) {
      console.error("Brevo API Key or Email Sender Address is not configured.");
      return res.status(500).json({ result: 'error', message: 'Email service not configured.' });
  }

  try {
    const data = req.body;
    
    // 1. التحقق من البيانات
    if (!data.toEmail || !data.toName || !data.cashPlusCode || !data.courseKey || !data.lang) {
      return res.status(400).json({ result: 'error', message: 'Missing required fields: toEmail, toName, cashPlusCode, courseKey, lang' });
    }

    // 2. حساب السعر
    const courseKey = data.courseKey || 'other';
    const originalPrice = courseData[courseKey].originalPrice;
    const amount = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;

    // 4. اختيار الترجمة
    const lang = emailTranslations[data.lang] ? data.lang : 'fr';
    const emailSubject = emailTranslations[lang].subject;
    const emailBody = emailTranslations[lang].body(data.cashPlusCode, amount);

    // 5. تجهيز الرسالة
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = emailSubject;
    sendSmtpEmail.htmlContent = `<html><body>${emailBody}</body></html>`;
    sendSmtpEmail.sender = { name: EMAIL_SENDER_NAME, email: EMAIL_SENDER_ADDRESS };
    sendSmtpEmail.to = [{ email: data.toEmail, name: data.toName }];
    
    // 6. إرسال الرسالة
    await apiInstance.sendTransacEmail(sendSmtpEmail);

    res.status(200).json({ result: 'success', message: 'Email sent successfully.' });

  } catch (error) {
    console.error('Email Sending Error (Brevo):', error.body || error.message);
    // إرجاع خطأ 200 (لعدم إيقاف الواجهة الأمامية) ولكن مع رسالة خطأ
    res.status(200).json({ result: 'error', message: `Email failed: ${error.message}` });
  }
};
