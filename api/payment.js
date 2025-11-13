import axios from 'axios';
import { Buffer } from 'buffer';

// --- إعدادات الأمان (يتم قراءتها من متغيرات البيئة) ---
const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY; 
const YOUCAN_PUBLIC_KEY = process.env.YOUCAN_PUBLIC_KEY; 
const YOUCAN_MODE = process.env.YOUCAN_MODE;

// --- إعدادات الدورات (لحساب السعر من جانب الخادم) ---
const courseData = {
    pmp: { originalPrice: 2800 },
    planning: { originalPrice: 2800 },
    qse: { originalPrice: 2450 },
    softskills: { originalPrice: 1700 },
    other: { originalPrice: 199 } // سعر افتراضي
};
const discountPercentage = 35; // نسبة الخصم

/**
 * الدالة الرئيسية التي تستقبل طلبات إنشاء الدفع
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

  try {
    const data = req.body; 

    // 1. حساب السعر (في الخادم)
    const courseKey = data.courseKey || 'other';
    if (!courseData[courseKey]) {
        throw new Error('Course not found');
    }
    const originalPrice = courseData[courseKey].originalPrice;
    const amount = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;

    // 2. تهيئة YouCanPay
    const keys = `${YOUCAN_PUBLIC_KEY}:${YOUCAN_PRIVATE_KEY}`;
    const base64Keys = Buffer.from(keys).toString('base64');
    
    const isSandbox = YOUCAN_MODE === 'sandbox';
    const youcanApiBaseUrl = isSandbox ? 'https://youcanpay.com/sandbox/api' : 'https://youcanpay.com/api';
    const tokenizeUrl = `${youcanApiBaseUrl}/tokenize`;

    // --- !!! [هذا هو التعديل الجذري] !!! ---
    // 3. تجميع كل البيانات في كائن واحد لإرسالها
    const bookingDetails = {
        // بيانات الحجز
        inquiryId: data.inquiryId,
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        selectedCourse: data.selectedCourse,
        qualification: data.qualification,
        experience: data.experience,
        
        // بيانات الدفع (التي نعرفها الآن)
        paymentMethod: data.paymentMethod, // (credit_card أو cashplus)
        amount: amount.toString(), // (المبلغ بالدرهم)
        currency: "MAD",
        currentLang: data.currentLang || 'fr', // تمرير اللغة للـ Webhook

        // بيانات التتبع (UTM)
        utm_source: data.utm_source || '',
        utm_medium: data.utm_medium || '',
        utm_campaign: data.utm_campaign || '',
        utm_term: data.utm_term || '',
        utm_content: data.utm_content || ''
    };
    // --- !!! [نهاية التجميع] !!! ---

    // 4. إنشاء "Token" الأولي
    const tokenResponse = await axios.post(tokenizeUrl, {
        pri_key: YOUCAN_PRIVATE_KEY, 
        amount: amount * 100, // السعر بالسنتيم
        currency: "MAD",
        order_id: data.inquiryId, 
        customer: {
            name: data.clientName,
            email: data.clientEmail,
            phone: data.clientPhone
        },
        
        // --- !!! [هذا هو الحل لمشكلة 10 items] !!! ---
        // حقن كل البيانات كنص واحد تحت مفتاح واحد (allData)
        metadata: {
            allData: JSON.stringify(bookingDetails)
        },
        // --- !!! [نهاية الحل] !!! ---

        redirect_url: `https://tadrib-cash.jaouadouarh.com#payment-success`, 
        error_url: `https://tadrib-cash.jaouadouarh.com#payment-failed`     
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    if (!tokenResponse.data || !tokenResponse.data.token) {
        console.error('YouCanPay API Error:', tokenResponse.data);
        throw new Error(tokenResponse.data.message || 'Failed to create YouCanPay token');
    }

    const tokenId = tokenResponse.data.token.id;

    // 5. التحقق من طريقة الدفع
    if (data.paymentMethod === 'cashplus') {
        const cashplusUrl = `${youcanApiBaseUrl}/cashplus/init`;
        const cashplusResponse = await axios.post(cashplusUrl, {
            pub_key: YOUCAN_PUBLIC_KEY,
            token_id: tokenId
        }, {
            headers: {
                'Authorization': `Basic ${base64Keys}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (!cashplusResponse.data || !cashplusResponse.data.token) {
            console.error('YouCanPay CashPlus Error:', cashplusResponse.data);
            throw new Error(cashplusResponse.data.message || 'Failed to initialize CashPlus payment');
        }

        res.status(200).json({ 
            result: 'success', 
            paymentMethod: 'cashplus',
            cashplus_code: cashplusResponse.data.token 
        });

    } else {
        // (البطاقة البنكية)
        res.status(200).json({ 
            result: 'success', 
            paymentMethod: 'credit_card',
            tokenId: tokenId 
        });
    }

  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error('Payment Initialization Error:', errorData);
    res.status(500).json({ result: 'error', message: 'Internal Server Error', details: errorData });
  }
};
