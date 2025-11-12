// --- [تصحيح]: تمت إعادة كتابته بالكامل لاستخدام (ESM) بدلاً من (CJS) ---
import axios from 'axios';
import { Buffer } from 'buffer';
// [حل المشكلة 2]: استيراد الأسعار من المصدر الوحيد (باستخدام ESM)
// ملاحظة: Vercel تتطلب غالباً الامتداد .js في الاستيراد
import { calculateDiscountedPrice } from './utils/pricing.js'; 

// 2. إعدادات الأمان (يتم قراءتها داخل الدالة)

/**
 * هذه هي الدالة الرئيسية التي تستقبل طلبات إنشاء الدفع
 */
export default async (req, res) => {

  // --- !!! [الإصلاح: قراءة المتغيرات داخل الدالة] !!! ---
  const YOUCAN_PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY; 
  const YOUCAN_PUBLIC_KEY = process.env.YOUCAN_PUBLIC_KEY; 
  const YOUCAN_MODE = process.env.YOUCAN_MODE || 'live'; // الافتراضي 'live'

  // السماح بالطلبات (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*'); // في الإنتاج، استبدل * بنطاقك
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
  }
  if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
  }
  
  try {
    // --- 1. استقبال كل البيانات من الواجهة الأمامية ---
    const {
        clientName,
        clientEmail,
        clientPhone,
        courseKey,
        selectedCourse,
        qualification,
        experience,
        paymentMethod,
        inquiryId,
        lang, // [حل المشكلة 3]: استقبال اللغة
        utm_source, // استقبال UTMs
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content
    } = req.body;

    // التحقق من وجود مفتاح الدورة
    if (!courseKey) {
        throw new Error('Course key (courseKey) is missing.');
    }

    // --- 2. حساب السعر (بشكل آمن من الخادم) ---
    // [حل المشكلة 2]: استخدام الدالة المركزية
    const amount = calculateDiscountedPrice(courseKey);

    // --- 3. تجهيز الاتصال بـ YouCanPay ---
    const API_URL = (YOUCAN_MODE === 'sandbox')
        ? 'https://youcanpay.com/sandbox/api' 
        : 'https://youcanpay.com/api';
        
    const tokenizeUrl = `${API_URL}/tokenize`;
    
    // --- 4. بناء الحمولة (Payload) ---
    const payload = {
        pri_key: YOUCAN_PRIVATE_KEY,
        amount: amount * 100, // تحويل الدرهم إلى سنتيم
        currency: 'MAD',
        order_id: inquiryId, 
        customer_info: {
            name: clientName,
            email: clientEmail,
            phone: clientPhone,
        },
        // [تعديل حاسم]: تمرير "كل" بيانات العميل + اللغة + الوضع إلى metadata
        metadata: {
            inquiry_id: inquiryId,
            client_name: clientName,
            client_email: clientEmail,
            client_phone: clientPhone,
            course_key: courseKey,
            course_name: selectedCourse,
            qualification: qualification,
            experience: experience,
            payment_method: paymentMethod,
            lang: lang, // [حل المشكلة 3]
            mode: YOUCAN_MODE, // [حل مشكلة Sandbox]
            // تمرير UTMs
            utm_source: utm_source || '',
            utm_medium: utm_medium || '',
            utm_campaign: utm_campaign || '',
            utm_term: utm_term || '',
            utm_content: utm_content || ''
        },
        // روابط إعادة التوجيه (مهمة للبطاقة البنكية)
        redirect_url: `https://tadrib.ma/#payment-success?id=${inquiryId}`, // استخدام الرابط الحقيقي
        error_url: `https://tadrib.ma/#payment-failed?id=${inquiryId}`
    };

    // --- 5. استدعاء Tokenize API ---
    const youcanResponse = await axios.post(tokenizeUrl, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    if (!youcanResponse.data || !youcanResponse.data.token_id) {
        console.error('YouCanPay Tokenize Error:', youcanResponse.data);
        throw new Error(youcanResponse.data.message || 'Failed to tokenize payment');
    }

    const tokenId = youcanResponse.data.token_id;

    // --- 6. منطق التوجيه (بطاقة أو كاش بلوس) ---
    if (paymentMethod === 'cashplus') {
        // --- 6.أ: منطق كاش بلوس ---
        const cashplusUrl = `${API_URL}/cashplus/init`;
        const base64Keys = Buffer.from(`${YOUCAN_PUBLIC_KEY}:${YOUCAN_PRIVATE_KEY}`).toString('base64');
        
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
        // --- 6.ب: منطق البطاقة البنكية ---
        const paymentUrl = `${API_URL}/checkout?token_id=${tokenId}`;
        res.status(200).json({ 
            result: 'success', 
            paymentMethod: 'credit_card',
            payment_url: paymentUrl // إرسال رابط الدفع
        });
    }

  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error('Payment Initialization Error:', errorData);
    res.status(500).json({ result: 'error', message: errorData.message || 'Internal Server Error' });
  }
};
