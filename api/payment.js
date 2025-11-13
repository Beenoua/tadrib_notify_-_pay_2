// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import axios from 'axios';
import { Buffer } from 'buffer';

// إعدادات الدورات
const courseData = {
  pmp: { originalPrice: 2800 },
  planning: { originalPrice: 2800 },
  qse: { originalPrice: 2450 },
  softskills: { originalPrice: 1700 },
  other: { originalPrice: 199 }
};

const discountPercentage = 35;

export default async (req, res) => {
  const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;
  const YOUCAN_PUBLIC_KEY = process.env.YOUCAN_PUBLIC_KEY;
  const YOUCAN_MODE = process.env.YOUCAN_MODE;

  // CORS
  const allowedOrigins = [
    'https://tadrib.ma',
    'https://tadrib.jaouadouarh.com',
    'https://tadrib-cash.jaouadouarh.com',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const data = req.body;

    // 🔥 1. استخراج جميع بيانات الحجز المطلوبة
    const inquiryId      = data.inquiryId;
    const name           = data.name;
    const email          = data.email;
    const phone          = data.phone;
    const qualification  = data.qualification;
    const experience     = data.experience;
    const courseKey      = data.courseKey;
    const lang           = data.lang;

    const utm_source     = data.utm_source;
    const utm_medium     = data.utm_medium;
    const utm_campaign   = data.utm_campaign;
    const utm_term       = data.utm_term;
    const utm_content    = data.utm_content;

    const paymentMethod  = data.paymentMethod;  // card | cashplus
    const cashplusCode   = data.cashplusCode || null;

    // 🔥 2. حساب السعر النهائي
    const originalPrice = courseData[courseKey]?.originalPrice || 0;
    const price = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;

    // 🔥 3. تجهيز metadata كاملة
    const metadata = {
      inquiry_id: inquiryId,
      name,
      email,
      phone,
      qualification,
      experience,
      course: courseKey,
      lang,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      payment_method: paymentMethod,
      cashplus_code: cashplusCode,
      price
    };

    // 🔥 4. تجهيز payload
    const keys = `${YOUCAN_PUBLIC_KEY}:${YOUCAN_PRIVATE_KEY}`;
    const base64Keys = Buffer.from(keys).toString('base64');

    const isSandbox = YOUCAN_MODE === 'sandbox';
    const baseUrl = isSandbox
      ? "https://youcanpay.com/sandbox/payment"
      : "https://youcanpay.com/payment";

    const payload = {
      amount: price,
      currency: "MAD",
      metadata: metadata,
      success_url: data.successUrl,
      error_url: data.errorUrl
    };

    // 🔥 5. إرسال الطلب إلى YouCanPay
    const response = await axios.post(baseUrl, payload, {
      headers: {
        "Authorization": `Basic ${base64Keys}`,
        "Content-Type": "application/json"
      }
    });

    return res.status(200).json({
      result: "success",
      url: response.data.redirect_url,
      metadataSent: metadata
    });

  } catch (error) {
    console.error("Payment API Error:", error.message);
    return res.status(500).json({
      result: "error",
      message: error.message
    });
  }
};
