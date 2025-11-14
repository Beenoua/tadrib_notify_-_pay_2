// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import axios from 'axios';
import { Buffer } from 'buffer';

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

  try {
    const data = req.body;

    const courseKey = data.courseKey || 'other';
    if (!courseData[courseKey]) throw new Error('Course not found');

    const originalPrice = courseData[courseKey].originalPrice;
    const amount = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;

    const keys = `${YOUCAN_PUBLIC_KEY}:${YOUCAN_PRIVATE_KEY}`;
    const base64Keys = Buffer.from(keys).toString('base64');

    const isSandbox = YOUCAN_MODE === 'sandbox';
    const youcanApiBaseUrl =
      isSandbox ? 'https://youcanpay.com/sandbox/api' : 'https://youcanpay.com/api';

    // Tokenize with full metadata
    const tokenResponse = await axios.post(
      `${youcanApiBaseUrl}/tokenize`,
      {
        pri_key: YOUCAN_PRIVATE_KEY,
        amount: amount * 100,
        currency: "MAD",
        order_id: data.inquiryId,
        customer: {
          name: data.clientName,
          email: data.clientEmail,
          phone: data.clientPhone
        },
        metadata: {
          inquiryId: data.inquiryId,
          course: data.selectedCourse,
          qualification: data.qualification,
          experience: data.experience,

          paymentMethod: data.paymentMethod,
          lang: data.currentLang || 'fr',
          originalPrice,
          finalAmount: amount
        },
        redirect_url: "https://tadrib-cash.jaouadouarh.com#payment-success",
        error_url: "https://tadrib-cash.jaouadouarh.com#payment-failed"
      },
      {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      }
    );

    if (!tokenResponse.data?.token)
      throw new Error("Failed to create token");

    const tokenId = tokenResponse.data.token.id;

    // CASHPLUS
    if (data.paymentMethod === 'cashplus') {
      const cashplusResponse = await axios.post(
        `${youcanApiBaseUrl}/cashplus/init`,
        { pub_key: YOUCAN_PUBLIC_KEY, token_id: tokenId },
        {
          headers: {
            'Authorization': `Basic ${base64Keys}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      return res.status(200).json({
        result: "success",
        paymentMethod: "cashplus",
        cashplus_code: cashplusResponse.data.token
      });
    }

    // CREDIT CARD
    return res.status(200).json({
      result: "success",
      paymentMethod: "credit_card",
      tokenId
    });

  } catch (error) {
    const err = error.response?.data || error.message;
    console.error("Payment Error:", err);
    res.status(500).json({ result: "error", details: err });
  }
};
