// --- ملف جديد: utils/pricing.js ---
// هذا الملف هو "مصدر الحقيقة الوحيد" لأسعار الدورات والخصومات.
// يجب أن يتم استيراده من قبل payment.js و send-code-email.js.

// [تعديل] استخدام `module.exports` بدلاً من `export` لضمان التوافق مع `require`
// (بما أن payment.js يستخدم `require`)

const courseData = {
    pmp: { originalPrice: 2800 },
    planning: { originalPrice: 2800 },
    qse: { originalPrice: 2450 },
    softskills: { originalPrice: 1700 },
    other: { originalPrice: 199 } // سعر "استفسار عام" (إذا تم تفعيله مستقبلاً)
};

const discountPercentage = 35; // نسبة الخصم

/**
 * دالة مركزية لحساب السعر المخفض.
 * @param {string} courseKey - مفتاح الدورة (مثل 'pmp').
 * @returns {number} - السعر النهائي بعد الخصم.
 */
function calculateDiscountedPrice(courseKey) {
    // التأكد من أن المفتاح موجود، وإلا استخدم 'other' كاحتياط
    const key = (courseKey && courseData[courseKey]) ? courseKey : 'other';
    
    const originalPrice = courseData[key].originalPrice;
    
    // حساب السعر المخفض وتقريبه لأقرب 50
    const discountedPrice = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;
    
    return discountedPrice;
}

// تصدير الوحدات لتكون متاحة لـ require
module.exports = {
    courseData,
    discountPercentage,
    calculateDiscountedPrice
};