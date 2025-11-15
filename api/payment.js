// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import axios from 'axios';
import { Buffer } from 'buffer';

// Input validation helpers
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  // Moroccan phone validation (simplified)
  const phoneRegex = /^(\+212|00212|212|0)?[6-7]\d{8}$/;
  return phoneRegex.test(phone.replace(/[\s\-]/g, ''));
}

function validateRequired(data, fields) {
  const missing = fields.filter(field => !data[field] || data[field].toString().trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

function sanitizeString(str) {
  return str ? str.toString().trim().replace(/[<>\"'&]/g, '') : '';
}

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

  // Validate environment variables
  if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
    console.error('Missing required environment variables: YOUCAN_PRIVATE_KEY or YOUCAN_PUBLIC_KEY');
    return res.status(500).json({ result: "error", message: "Server configuration error" });
  }

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

  // Log request for debugging
  console.log(`Payment request from ${origin || 'unknown'} at ${new Date().toISOString()}`);

  try {
    const data = req.body;

    // Validate required fields
    validateRequired(data, ['clientName', 'clientEmail', 'clientPhone', 'inquiryId']);

    // Validate and sanitize inputs
    if (!validateEmail(data.clientEmail)) {
      throw new Error('Invalid email format');
    }
    if (!validatePhone(data.clientPhone)) {
      throw new Error('Invalid phone number format');
    }

    const courseKey = sanitizeString(data.courseKey) || 'other';
    if (!courseData[courseKey]) {
      throw new Error(`Invalid course key: ${courseKey}`);
    }

    const originalPrice = courseData[courseKey].originalPrice;
    const amount = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;

    // Ensure amount is positive
    if (amount <= 0) {
      throw new Error('Calculated amount is invalid');
    }

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
        order_id: sanitizeString(data.inquiryId),
        customer: {
          name: sanitizeString(data.clientName),
          email: sanitizeString(data.clientEmail),
          phone: sanitizeString(data.clientPhone)
        },
        metadata: {
          inquiryId: sanitizeString(data.inquiryId),
          course: sanitizeString(data.selectedCourse),
          qualification: sanitizeString(data.qualification),
          experience: sanitizeString(data.experience),
          paymentMethod: sanitizeString(data.paymentMethod),
          lang: sanitizeString(data.currentLang) || 'fr',
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

    if (!tokenResponse.data?.token?.id) {
      throw new Error("Failed to create payment token");
    }

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

      if (!cashplusResponse.data?.token) {
        throw new Error("Failed to generate CashPlus code");
      }

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
    console.error("Payment Error:", error.message);

    // Sanitize error message for client
    let clientMessage = "An error occurred during payment processing";
    if (error.message.includes('Invalid') || error.message.includes('Missing')) {
      clientMessage = error.message;
    }

    res.status(400).json({ result: "error", message: clientMessage });
  }
};
