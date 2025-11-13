import TelegramBot from "node-telegram-bot-api";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let doc = null;

async function authSheets() {
  const auth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
  await doc.loadInfo();
}

export default async (req, res) => {
  try {
    const body = req.body;

    // 🔥 قراءة metadata مهما كان شكل webhook
    const meta = body.metadata || body.data?.metadata || {};

    // بيانات الحجز
    const inquiryId     = meta.inquiry_id;
    const name          = meta.name;
    const email         = meta.email;
    const phone         = meta.phone;
    const qualification = meta.qualification;
    const experience    = meta.experience;
    const course        = meta.course;
    const lang          = meta.lang;

    const utm_source    = meta.utm_source;
    const utm_medium    = meta.utm_medium;
    const utm_campaign  = meta.utm_campaign;
    const utm_term      = meta.utm_term;
    const utm_content   = meta.utm_content;

    const paymentMethod = meta.payment_method;
    const cashplusCode  = meta.cashplus_code;
    const price         = meta.price;

    // 🔥 معلومات البطاقة من YouCanPay
    const last4 = body.card?.last4 || body.data?.card?.last4 || null;
    const cardBrand = body.card?.brand || null;

    // 🔥 معلومات الدفع
    const transactionId = body.transaction_id || body.data?.transaction_id;
    const paymentStatus = body.status || body.data?.status;

    // 🔥 تخزين فـ Google Sheets (يمكن تبدلها لـ Supabase لاحقاً)
    await authSheets();
    const sheet = doc.sheetsByIndex[0];

    await sheet.addRow({
      InquiryID: inquiryId,
      Name: name,
      Email: email,
      Phone: phone,
      Qualification: qualification,
      Experience: experience,
      Course: course,
      Price: price,
      PaymentMethod: paymentMethod,
      CashPlusCode: cashplusCode,
      CardLast4: last4,
      CardBrand: cardBrand,
      Status: paymentStatus,
      TransactionID: transactionId,
      UTM_Source: utm_source,
      UTM_Medium: utm_medium,
      UTM_Campaign: utm_campaign,
      Time: new Date().toISOString()
    });

    return res.status(200).json({ result: "success" });

  } catch (error) {
    console.error("Webhook Error:", error.message);
    return res.status(500).json({ result: "error", msg: error.message });
  }
};
