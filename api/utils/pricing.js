// --- ملف جديد: utils/pricing.js ---
// [تصحيح]: تمت إعادة كتابته بالكامل لاستخدام (ESM) بدلاً من (CJS)

// تصدير المتغيرات مباشرة
export const courseData = {
    pmp: { originalPrice: 2800 },
    planning: { originalPrice: 2800 },
    qse: { originalPrice: 2450 },
    softskills: { originalPrice: 1700 },
    other: { originalPrice: 199 } // سعر "استفسار عام" (إذا تم تفعيله مستقبلاً)
};

export const discountPercentage = 35; // نسبة الخصم

/**
 * دالة مركزية لحساب السعر المخفض.
 * @param {string} courseKey - مفتاح الدورة (مثل 'pmp').
 * @returns {number} - السعر النهائي بعد الخصم.
 */
export function calculateDiscountedPrice(courseKey) {
    // التأكد من أن المفتاح موجود، وإلا استخدم 'other' كاحتياط
    const key = (courseKey && courseData[courseKey]) ? courseKey : 'other';
    
    const originalPrice = courseData[key].originalPrice;
    
    // حساب السعر المخفض وتقريبه لأقرب 50
    const discountedPrice = Math.round((originalPrice * (1 - discountPercentage / 100)) / 50) * 50;
    
    return discountedPrice;
}

// ليس مطلوباً تصدير افتراضي، سيتم استيراد الدوال بالاسم
