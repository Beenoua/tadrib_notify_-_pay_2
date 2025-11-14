// --- تم التعديل: استخدام 'import' بدلاً من 'require' ---
import axios from 'axios';
import { Buffer } from 'buffer'; // إضافة Buffer

// إعدادات الدورات (يجب أن تكون الأسعار هنا في الخادم للأمان)
const courseData = {
    pmp: { originalPrice: 2800 },
    planning: { originalPrice: 2800 },
    qse: { originalPrice: 2450 },
    softskills: { originalPrice: 1700 },
    other: { originalPrice: 199 } // إضافة سعر افتراضي
};
const discountPercentage = 35; // نسبة الخصم

/**
 * هذه هي الدالة الرئيسية التي تستقبل طلبات إنشاء الدفع
 */
export default async (req, res) => {

  // --- قراءة المتغيرات داخل الدالة ---
  const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY; 
  const YOUCAN_PUBLIC_KEY = process.env.YOUCAN_PUBLIC_KEY; 
  const YOUCAN_MODE = process.env.YOUCAN_MODE;
  
  console.log(`[PAYMENT_DEBUG] YOUCAN_MODE: ${YOUCAN_MODE}`);

  
  // ===================================
  //           **إعدادات CORS**
  // ===================================
  const allowedOrigins = [
    'https://tadrib.ma', 
    'https://tadrib.jaouadouarh.com', 
    'https://tadrib-cash.jaouadouarh.com',
    'http://localhost:3000', // للتجارب المحلية
    'http://127.0.0.1:5500', // للتجارب المحلية
    'http://127.0.0.1:5501', // إضافة منفذ آخر للتجارب
    'http://127.0.0.1:5502',
    'http://127.0.0.1:5503',
    'http://127.0.0.1:5504',
    'http://127.0.0.1:5505',
    'http://127.0.0.1:5506',
    'http://127.0.0.1:5507',
    'http://127.0.0.1:5508',
    'http://127.0.0.1:5509',
    'http://127.0.0.1:55010'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // ===================================

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

    // 1. التحقق من الدورة وحساب السعر (في الخادم)
    const courseKey = data.courseKey || 'other'; // افتراضي
    if (!courseData[courseKey]) {
        throw new Error('Course not found');
    }
    const originalPrice = courseData[courseKey].originalPrice;
    const amount = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50; // هذا هو المبلغ بالدرهم

    // --- [***[FIX 1]***] ---
    // 2. تجميع كل البيانات في كائن واحد بأسماء موحدة
    const allDataForPayload = {
        // بيانات العميل
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        
        // [تصحيح]: استخدام الأسماء الصحيحة القادمة من الواجهة
        inquiryId: data.inquiryId,
        courseText: data.selectedCourse,  // <-- كان 'course: data.course'
        qualText: data.qualification,     // <-- كان 'qualification: data.qualification'
        expText: data.experience,         // <-- كان 'experience: data.experience'
        
        // [إضافة]: حفظ المبلغ والعملة داخل الحزمة لضمان وصولها
        amount: amount, // (المبلغ بالدرهم، مثلا 1800)
        currency: "MAD",

        // بيانات التتبع
        lang: data.lang, // <-- يعتمد على الإضافة من script-cleaned-2.js
        paymentMethod: data.paymentMethod, 
        utm_source: data.utm_source || null,
        utm_medium: data.utm_medium || null,
        utm_campaign: data.utm_campaign || null,
        utm_term: data.utm_term || null,
        utm_content: data.utm_content || null
    };
    // --- [نهاية التحديث] ---

    // 3. تهيئة YouCanPay
    const keys = `${YOUCAN_PUBLIC_KEY}:${YOUCAN_PRIVATE_KEY}`;
    const base64Keys = Buffer.from(keys).toString('base64');
    
    const isSandbox = YOUCAN_MODE === 'sandbox';
    const youcanApiBaseUrl = isSandbox ? 'https://youcanpay.com/sandbox/api' : 'https://youcanpay.com/api';

    const tokenizeUrl = `${youcanApiBaseUrl}/tokenize`;
    console.log(`[PAYMENT_DEBUG] Calling Tokenize API: ${tokenizeUrl}`);

    // 4. إنشاء "Token" الأولي (مشترك لكل الطرق)
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
        // --- [تحديث] ---
        metadata: {
            // ضغط كل البيانات في حقل واحد كـ JSON
            payload: JSON.stringify(allDataForPayload)
        },
        // --- [نهاية التحديث] ---
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

    if (data.paymentMethod === 'cashplus') {
        // --- 5.أ: منطق كاش بلوس ---
        const cashplusUrl = `${youcanApiBaseUrl}/cashplus/init`;
        console.log(`[PAYMENT_DEBUG] Calling CashPlus API: ${cashplusUrl}`);
        
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
        // --- 5.ب: منطق البطاقة البنكية (الافتراضي) ---
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
