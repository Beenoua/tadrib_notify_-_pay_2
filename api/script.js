/*
 * ===================================================================
 * Client-Side Analytics Engine (Full Enterprise Version)
 * ===================================================================
 * هذا الملف هو المحرك الرئيسي للوحة التحكم.
 * المبدأ: (Addition NOT Replacement) - توسيع الوظائف الحالية.
 *
 * يغطي:
 * 1. المؤشرات المالية (Revenue, Trends) - [موجود ومحسن]
 * 2. المعاملات (Transactions, Funnel) - [موجود ومحسن]
 * 3. التسويق والديموغرافيا (Campaigns, Experience) - [تم الإصلاح والتفعيل]
 * 4. إدارة الجدول والبيانات - [موجود]
 */

class AdminDashboard {
    constructor() {
        // مخازن البيانات
        this.allData = [];
        this.filteredData = [];

        // إعدادات الجدول
        this.currentPage = 1;
        this.itemsPerPage = 20;

        // مخزن الشارتات (لتدميرها قبل إعادة الرسم لمنع التداخل)
        this.charts = {
            trend: null,
            payment: null,
            funnel: null,
            language: null,
            experience: null // (تمت الإضافة: شارت الخبرة)
        };

        this.API_URL = 'https://tadrib-notify-pay-2.vercel.app/api/admin';
        this.courseLookupMap = this.createCourseLookupMap();

        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
    }

    // ============================================================
    // 1. Data Fetching (جلب البيانات)
    // ============================================================
    async fetchAllData() {
        this.setLoadingState(true);
        const tableBody = document.getElementById('table-body');

        // رسالة تحميل مؤقتة
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="12" class="text-center p-10 text-gray-500">جاري الاتصال بقاعدة البيانات وجلب السجلات...</td></tr>`;

        try {
            const authHeaders = this.getAuthHeaders();
            const response = await fetch(this.API_URL, {
                method: 'GET',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders)
            });

            if (response.ok) {
                const result = await response.json();
                // --- [أضف هذا السطر هنا] ---
                this.spendData = result.spendData || []; 
                // ---------------------------
                // مزامنة حالة المستخدم فوراً مع البيانات القادمة من السيرفر
                if (result.currentUser) {
                    this.syncUserState(result.currentUser);
                }

                // معالجة البيانات الأولية وتحويلها لصيغة قابلة للتحليل
                this.allData = (result.data || []).map(item => {
                    item.parsedDate = this.parseDate(item.timestamp);
                    item.finalAmount = parseFloat(item.finalAmount) || 0;

                    // تطبيع النصوص (Normalization) لضمان دقة الفلترة
                    item.status = (item.status || 'pending').toLowerCase();
                    item.paymentMethod = (item.paymentMethod || 'other').toLowerCase();
                    item.normalizedCourse = this.normalizeCourseName(item.course);
                    item.language = (item.language || 'unknown').toLowerCase();

                    // (FIX) معالجة حقول التسويق والخبرة لتجنب "Undefined"
                    item.utm_source = item.utm_source && item.utm_source !== 'undefined' ? item.utm_source : 'Direct/None';
                    item.utm_campaign = item.utm_campaign && item.utm_campaign !== 'undefined' ? item.utm_campaign : 'Organic';
                    item.experience = item.experience || 'غير محدد';

                    return item;
                });

                // ترتيب البيانات: الأحدث أولاً
                this.allData.sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0));

                // بدء تشغيل المحرك
                this.applyLocalFilters();

            } else if (response.status === 401) {
                this.logout();
            } else {
                throw new Error(`فشل الاتصال بالسيرفر: ${response.status}`);
            }
        } catch (error) {
            console.error('Data Load Error:', error);
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="12" class="text-center p-10 text-red-500 font-bold">خطأ: ${error.message}</td></tr>`;
        } finally {
            this.setLoadingState(false);
        }
    }
   applyPermissionsUI() {
    const perms = JSON.parse(sessionStorage.getItem('user_permissions') || '{"can_edit":false, "can_view_stats":false}');
    const role = sessionStorage.getItem('user_role');

    // 1. منطق التعتيم (Blurring) للإحصائيات والأمور المالية
    if (role !== 'super_admin' && !perms.can_view_stats) {
        const sensitiveSelectors = [
            '#metrics-cards', 
            '#revenue-stats-breakdown', 
            '#paid-payments-stats',
            '#total-payments-stats',
            '#metrics-daily-revenue-chart',
            '#payment-method-chart',
            '#top-campaigns-body',
            '#course-stats-container',
            '#experience-chart',
            '#language-chart',
            // --- إضافة جديدة: استهداف عمود المبلغ في الجدول ---
            '#data-table tbody tr td:nth-child(10)', // تعتيم خلايا المبلغ
            '#data-table thead tr th:nth-child(10)', // تعتيم عنوان العمود
             // تعتيم البطاقات الجانبية للإحصائيات التفصيلية
            '.filtered-stat-wrapper', 
            '#metrics-daily-funnel-chart',
            '#metrics-cards'
        ];

        sensitiveSelectors.forEach(selector => {
            const els = document.querySelectorAll(selector);
            els.forEach(el => {
                el.style.filter = 'blur(5px)'; // درجة تعتيم قوية
                el.style.pointerEvents = 'none'; // منع النقر
                el.style.userSelect = 'none';   // منع التحديد والنسخ
                el.style.opacity = '0.6';       // تخفيف الشفافية قليلاً
            });
        });
    }

    // 2. منطق إخفاء أزرار التعديل في الجدول
    if (role !== 'super_admin' && !perms.can_edit) {
        // نخفي أزرار التعديل في كل صفوف الجدول
        const actionButtons = document.querySelectorAll('#data-table button');
        actionButtons.forEach(btn => {
            // نجعل الأزرار شبه مختفية وغير قابلة للنقر
            btn.disabled = true;
            btn.classList.add('opacity-10', 'cursor-not-allowed', 'grayscale');
            // إزالة حدث النقر نهائياً
            btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); return false; };
        });
        
        // إخفاء زر "إضافة يدوية" بالكامل
        const addBtn = document.getElementById('add-btn');
        if(addBtn) addBtn.style.display = 'none';
    }
}

    // ============================================================
    // (NEW) دالة مزامنة حالة المستخدم مع السيرفر
    // ============================================================
    syncUserState(serverUser) {
        if (!serverUser) return;

        // 1. التحقق من التجميد الفوري
        // إذا اكتشفنا أن المستخدم مجمد، نطرده فوراً
        if (serverUser.is_frozen) {
            alert('تم تجميد حسابك من قبل الإدارة.');
            this.logout();
            return;
        }

        const currentRole = sessionStorage.getItem('user_role');
        const currentPerms = sessionStorage.getItem('user_permissions');

        // 2. التحقق من تغير الدور (Role)
        // مثلاً: تم تحويله من Editor إلى Super Admin أو العكس
        if (serverUser.role !== currentRole) {
            console.log(`Role changed from ${currentRole} to ${serverUser.role}. Updating UI...`);
            sessionStorage.setItem('user_role', serverUser.role);
            // تحديث زر الإعدادات فوراً
            this.updateSettingsButtonVisibility(serverUser.role);
            this.updateutmbuilderButtonVisibility(serverUser.role);
            this.updatemanagespendButtonVisibility(serverUser.role);
            this.updaterecordspendButtonVisibility(serverUser.role);
        }

        // 3. التحقق من تغير الصلاحيات (Permissions)
        const newPermsStr = JSON.stringify(serverUser.permissions);
        if (newPermsStr !== currentPerms) {
            console.log('Permissions changed. Updating UI...');
            sessionStorage.setItem('user_permissions', newPermsStr);
            // إعادة تطبيق الصلاحيات على الواجهة (Blurring etc)
            this.applyPermissionsUI(); 
        }
    }

    // دالة مساعدة لإظهار/إخفاء زر الإعدادات ديناميكياً
    updateSettingsButtonVisibility(role) {
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            if (role === 'super_admin') {
                settingsBtn.classList.remove('hidden');
            } else {
                settingsBtn.classList.add('hidden');
            }
        }
    }

    updateutmbuilderButtonVisibility(role) {
        const settingsBtn = document.getElementById('utm-builder-btn');
        if (settingsBtn) {
            if (role === 'super_admin') {
                settingsBtn.classList.remove('hidden');
            } else {
                settingsBtn.classList.add('hidden');
            }
        }
    }

    updatemanagespendButtonVisibility(role) {
        const settingsBtn = document.getElementById('manage-spend-btn');
        if (settingsBtn) {
            if (role === 'super_admin') {
                settingsBtn.classList.remove('hidden');
            } else {
                settingsBtn.classList.add('hidden');
            }
        }
    }

     updaterecordspendButtonVisibility(role) {
        const settingsBtn = document.getElementById('record-spend-btn');
        if (settingsBtn) {
            if (role === 'super_admin') {
                settingsBtn.classList.remove('hidden');
            } else {
                settingsBtn.classList.add('hidden');
            }
        }
    }
    
    // ============================================================
    // 2. Filtering Engine (محرك الفلترة)
    // ============================================================
    applyLocalFilters() {
        // قراءة جميع الفلاتر من الواجهة
        const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();
        const statusFilter = document.getElementById('status-filter')?.value || '';
        const paymentFilter = document.getElementById('payment-filter')?.value || '';
        const courseFilter = document.getElementById('course-filter')?.value || '';
        const dateFilter = document.getElementById('date-filter')?.value || 'all';
        const startDateVal = document.getElementById('start-date')?.value;
        const endDateVal = document.getElementById('end-date')?.value;

        // تطبيق المنطق على كل صف
        this.filteredData = this.allData.filter(item => {
            // 1. البحث النصي (يشمل الاسم، الإيميل، الهاتف، الدورة، المصدر)
            const searchTargets = [
                item.customerName, item.customerEmail, item.customerPhone,
                item.course, item.inquiryId, item.utm_source
            ].join(' ').toLowerCase();

            if (searchTerm && !searchTargets.includes(searchTerm)) return false;

            // 2. الفلاتر المحددة
            if (statusFilter && item.status !== statusFilter) return false;
            if (paymentFilter && item.paymentMethod !== paymentFilter) return false;
            if (courseFilter && item.normalizedCourse !== courseFilter) return false;

            // 3. فلترة التاريخ
            if (dateFilter !== 'all') {
                if (!item.parsedDate) return false;
                const itemTime = item.parsedDate.getTime();
                const now = new Date();
                let limit;

                switch (dateFilter) {
                    case 'hour': limit = now.getTime() - (60 * 60 * 1000); break;
                    case 'day': limit = now.getTime() - (24 * 60 * 60 * 1000); break;
                    case 'week': limit = now.getTime() - (7 * 24 * 60 * 60 * 1000); break;
                    case 'month': limit = now.getTime() - (30 * 24 * 60 * 60 * 1000); break;
                    case '3month': const d3 = new Date(); d3.setMonth(d3.getMonth() - 3); limit = d3.getTime(); break;
                    case 'year': const dy = new Date(); dy.setFullYear(dy.getFullYear() - 1); limit = dy.getTime(); break;
                    case 'custom':
                        if (startDateVal && itemTime < new Date(startDateVal).getTime()) return false;
                        if (endDateVal) {
                            const end = new Date(endDateVal); end.setHours(23, 59, 59);
                            if (itemTime > end.getTime()) return false;
                        }
                        return true;
                    default: limit = 0;
                }
                if (limit && itemTime < limit) return false;
            }
            return true;
        });

        this.currentPage = 1;
        this.updateDashboardUI();
    }

    // ============================================================
    // 3. UI Update Coordinator (مدير تحديث الواجهة)
    // ============================================================
    updateDashboardUI() {
        // 1. حساب KPIs للإجمالي والمفلتر
        const overallStats = this.calculateKPIs(this.allData);
        const filteredStats = this.calculateKPIs(this.filteredData);

        // 2. تحديث البطاقات العلوية (Split Stats)
        this.renderSplitStatsCards(overallStats, filteredStats);

        // 3. رسم الشارتات الأساسية (Trends, Payment, Language)
        this.renderAdvancedCharts(this.filteredData);

        // 4. (NEW - FIX) رسم الشارتات التي كانت "جامدة" سابقاً
        // نتأكد من وجود البيانات قبل محاولة الرسم
        if (this.filteredData.length > 0) {
            this.renderExperienceChart(this.filteredData);
            this.renderCampaignsTable(this.filteredData);
        } else {
            this.clearCampaignsTable(); // مسح الجدول إذا لم توجد بيانات
        }

        // 5. تحديث الجدول وإحصائيات الدورات
        this.renderTable();
        this.renderCourseStatistics(this.filteredData);
        this.populateCourseFilterOptions(this.allData);

        // 6. التحكم في ظهور "القسم المفلتر"
        const isFiltered = this.allData.length !== this.filteredData.length;
        document.querySelectorAll('.filtered-stat-wrapper').forEach(el => {
            if (isFiltered) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });
        // 7. (هام جداً) تطبيق الصلاحيات والتعتيم بعد رسم كل شيء
    this.applyPermissionsUI(); // <--- أضف هذا السطر هنا
    }

    // ============================================================
    // 4. Analytics Engine (محرك الحسابات)
    // ============================================================
    // ============================================================
    // استبدل دالة calculateKPIs القديمة بهذه النسخة
    // ============================================================
    calculateKPIs(dataSet) {
        const stats = {
            totalRevenue: 0, paidRevenue: 0, pendingRevenue: 0, failedRevenue: 0, canceledRevenue: 0,
            totalTx: dataSet.length, paidTx: 0, pendingTx: 0, failedTx: 0, canceledTx: 0,
            // العدادات لكل نوع
            cashplusCount: 0, cardCount: 0, cashCount: 0, bankCount: 0,
            // الإيرادات لكل نوع (للمدفوع فقط)
            paid_cashplus: 0, paid_card: 0, paid_cash: 0, paid_bank: 0,
            net_cashplus_revenue: 0, net_card_revenue: 0, net_cash_revenue: 0, net_bank_revenue: 0
        };

        dataSet.forEach(item => {
            const amount = item.finalAmount;
            // تطبيع طريقة الدفع
            const pm = (item.paymentMethod || '').toLowerCase();

            // تصنيف العدادات
            if (pm === 'cashplus') stats.cashplusCount++;
            else if (pm === 'card' || pm === 'credit_card') stats.cardCount++;
            else if (pm === 'cash') stats.cashCount++;
            else if (pm.includes('bank') || pm === 'virement') stats.bankCount++;

            switch (item.status) {
                case 'paid':
                    stats.paidTx++;
                    stats.paidRevenue += amount;
                    stats.totalRevenue += amount; // Revenue المجمع

                    // تفصيل الإيرادات حسب المصدر
                    if (pm === 'cashplus') { stats.paid_cashplus++; stats.net_cashplus_revenue += amount; }
                    else if (pm === 'card' || pm === 'credit_card') { stats.paid_card++; stats.net_card_revenue += amount; }
                    else if (pm === 'cash') { stats.paid_cash++; stats.net_cash_revenue += amount; }
                    else if (pm.includes('bank') || pm === 'virement') { stats.paid_bank++; stats.net_bank_revenue += amount; }
                    break;
                case 'pending':
                case 'pending_cashplus':
                    stats.pendingTx++;
                    stats.pendingRevenue += amount;
                    break;
                case 'failed':
                    stats.failedTx++;
                    stats.failedRevenue += amount;
                    break;
                case 'canceled':
                    stats.canceledTx++;
                    stats.canceledRevenue += amount;
                    break;
            }
        });
        stats.aov = stats.paidTx > 0 ? Math.round(stats.paidRevenue / stats.paidTx) : 0;
        return stats;
    }

    // ============================================================
    // 5. Charts Implementation (تنفيذ الشارتات)
    // ============================================================
    renderAdvancedCharts(dataSet) {
        // --- A. Daily Revenue Trend (Chart.js Line) ---
        const dailyRevenue = {};
        dataSet.forEach(item => {
            if (item.status === 'paid' && item.parsedDate) {
                const dateKey = item.parsedDate.toISOString().split('T')[0];
                dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + item.finalAmount;
            }
        });
        const sortedDates = Object.keys(dailyRevenue).sort();

        this.renderChart('metrics-daily-revenue-chart', 'trend', 'line', {
            labels: sortedDates,
            datasets: [{
                label: 'الإيرادات (MAD)',
                data: sortedDates.map(d => dailyRevenue[d]),
                borderColor: '#10B981', // لون أخضر احترافي
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.3,
                fill: true
            }]
        });

        // --- B. Payment Method Distribution (Doughnut) ---
        const pmCounts = { 'cashplus': 0, 'card': 0, 'cash': 0, 'bank': 0, 'other': 0 };
        dataSet.forEach(i => {
            const pm = (i.paymentMethod || '').toLowerCase();
            if (pm === 'cashplus') pmCounts.cashplus++;
            else if (pm === 'card' || pm === 'credit_card') pmCounts.card++;
            else if (pm === 'cash') pmCounts.cash++;
            else if (pm.includes('bank') || pm === 'virement') pmCounts.bank++;
            else pmCounts.other++;
        });

        this.renderChart('payment-method-chart', 'payment', 'doughnut', {
            labels: ['كاش بلوس', 'بطاقة بنكية', 'نقد (Cash)', 'تحويل بنكي', 'أخرى'],
            datasets: [{
                data: [pmCounts.cashplus, pmCounts.card, pmCounts.cash, pmCounts.bank, pmCounts.other],
                backgroundColor: [
                    '#F59E0B', // CashPlus (Orange)
                    '#2563EB', // Card (Blue)
                    '#10B981', // Cash (Green - New)
                    '#8B5CF6', // Bank (Purple - New)
                    '#9CA3AF'  // Other (Gray)
                ],
                borderWidth: 0
            }]
        });

        // --- C. Conversion Funnel (Bar/Line Combo) ---
        const funnelData = {};
        dataSet.forEach(item => {
            if (!item.parsedDate) return;
            const k = item.parsedDate.toISOString().split('T')[0];
            if (!funnelData[k]) funnelData[k] = { inq: 0, conv: 0 };
            funnelData[k].inq++; // كل صف هو طلب
            if (item.status === 'paid') funnelData[k].conv++; // التحويل الناجح
        });
        const fDates = Object.keys(funnelData).sort();

        const funnelCanvas = document.getElementById('metrics-daily-funnel-chart');
        if (funnelCanvas) {
            this.renderChart('metrics-daily-funnel-chart', 'funnel', 'bar', {
                labels: fDates,
                datasets: [
                    { label: 'الطلبات (Inquiries)', data: fDates.map(d => funnelData[d].inq), backgroundColor: 'rgba(37, 99, 235, 0.6)', order: 2 },
                    { label: 'المدفوع (Paid)', data: fDates.map(d => funnelData[d].conv), backgroundColor: 'rgba(16, 185, 129, 0.8)', order: 3 },
                    {
                        type: 'line', label: 'نسبة التحويل %',
                        data: fDates.map(d => funnelData[d].inq > 0 ? (funnelData[d].conv / funnelData[d].inq) * 100 : 0),
                        borderColor: '#F59E0B', borderWidth: 2, fill: false, yAxisID: 'y1', order: 1
                    }
                ]
            }, {
                scales: {
                    y: { beginAtZero: true, position: 'left' },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } }
                }
            });

            // إدارة حالة عدم وجود بيانات
            const emptyMsg = document.getElementById('metrics-daily-funnel-empty');
            if (emptyMsg) {
                if (fDates.length === 0) { funnelCanvas.style.display = 'none'; emptyMsg.classList.remove('hidden'); }
                else { funnelCanvas.style.display = 'block'; emptyMsg.classList.add('hidden'); }
            }
        }

        // --- D. Language Distribution ---
        const langCounts = { 'ar': 0, 'fr': 0, 'en': 0 };
        dataSet.forEach(i => {
            if (langCounts[i.language] !== undefined) langCounts[i.language]++;
            else langCounts['fr']++;
        });

        if (document.getElementById('language-chart')) {
            this.renderChart('language-chart', 'language', 'bar', {
                labels: ['العربية', 'الفرنسية', 'الإنجليزية'],
                datasets: [{
                    label: 'اللغة',
                    data: [langCounts.ar, langCounts.fr, langCounts.en],
                    backgroundColor: ['#10B981', '#3B82F6', '#F59E0B'],
                    borderRadius: 4
                }]
            }, { scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } });
        }

        // --------------------------------------------------------
        // E. Key Metrics Cards (Classic Design + Full Financial Logic)
        // --------------------------------------------------------
        const cards = document.getElementById('metrics-cards');
        if (cards) {
            document.getElementById('metrics-section')?.classList.remove('hidden');
            
            // 1. الحسابات (المنطق المالي والتشغيلي)
            const stats = this.calculateKPIs(dataSet);
            const revenue = stats.paidRevenue;
            const totalTx = stats.totalTx;
            const successRate = totalTx > 0 ? ((stats.paidTx / totalTx) * 100).toFixed(1) : 0;
            const aov = stats.aov;

            // حساب المصاريف (مع الفلترة)
            let totalSpend = 0;
            const dateFilter = document.getElementById('date-filter')?.value || 'all';
            const startDate = document.getElementById('start-date')?.value;
            const endDate = document.getElementById('end-date')?.value;

            if (this.spendData && Array.isArray(this.spendData)) {
                const filteredSpend = this.spendData.filter(s => {
                    const sDate = new Date(s.date + 'T00:00:00'); 
                    const now = new Date();
                    let limit;
                    
                    if (dateFilter === 'all') return true;
                    // ... (منطق التاريخ المختصر هنا) ...
                    switch (dateFilter) {
                        case 'day': limit = now.getTime() - (24 * 60 * 60 * 1000); break;
                        case 'week': limit = now.getTime() - (7 * 24 * 60 * 60 * 1000); break;
                        case 'month': limit = now.getTime() - (30 * 24 * 60 * 60 * 1000); break;
                        case '3month': const d3 = new Date(); d3.setMonth(d3.getMonth() - 3); limit = d3.getTime(); break;
                        case 'year': const dy = new Date(); dy.setFullYear(dy.getFullYear() - 1); limit = dy.getTime(); break;
                        case 'custom':
                            if (startDate && sDate < new Date(startDate)) return false;
                            if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59); if (sDate > end) return false; }
                            return true;
                        default: limit = 0;
                    }
                    if (limit && sDate.getTime() < limit) return false;
                    return true;
                });
                totalSpend = filteredSpend.reduce((sum, item) => sum + (parseFloat(item.spend) || 0), 0);
            }

            // المؤشرات المشتقة
            const netProfit = revenue - totalSpend;
            const roas = totalSpend > 0 ? (revenue / totalSpend) : 0;
            const cpa = stats.paidTx > 0 ? (totalSpend / stats.paidTx) : 0;

            // منطق الألوان (نفس المنطق الذي طلبته)
            const profitColor = netProfit >= 0 ? 'text-green-600' : 'text-red-600';
            const profitBorder = netProfit >= 0 ? 'border-green-500' : 'border-red-500';
            const profitIconBg = netProfit >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600';

            let roasColor = 'text-gray-600';
            if (roas >= 4) roasColor = 'text-green-600';
            else if (roas >= 2) roasColor = 'text-yellow-600';
            else if (totalSpend > 0) roasColor = 'text-red-600';

            // دالة مساعدة لرسم البطاقة الكلاسيكية
            const createClassicCard = (title, value, subText, valueColor, borderColor, iconBg, iconPath) => `
                <div class="bg-white p-4 rounded-lg border-t-4 ${borderColor} shadow-sm hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">${title}</span>
                            <div class="mt-1 text-2xl font-bold ${valueColor} dir-ltr font-mono">${value} <span class="text-xs text-gray-400 font-sans">${subText}</span></div>
                        </div>
                        <div class="p-2 ${iconBg} rounded-full">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                ${iconPath}
                            </svg>
                        </div>
                    </div>
                </div>
            `;

            // رسم البطاقات (8 بطاقات بالتصميم الكلاسيكي)
            cards.innerHTML = `
                ${createClassicCard('إجمالي المصاريف', totalSpend.toLocaleString(), 'MAD', 'text-gray-800', 'border-orange-500', 'bg-orange-50 text-orange-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>')}
                
                ${createClassicCard('إجمالي الإيرادات', revenue.toLocaleString(), 'MAD', 'text-blue-700', 'border-blue-500', 'bg-blue-50 text-blue-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>')}
                
                ${createClassicCard('صافي الربح', (netProfit > 0 ? '+' : '') + netProfit.toLocaleString(), 'MAD', profitColor, profitBorder, profitIconBg, '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>')}
                
                ${createClassicCard('العائد الإعلاني (ROAS)', roas.toFixed(2) + 'x', '', roasColor, 'border-purple-500', 'bg-purple-50 text-purple-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>')}

                ${createClassicCard('إجمالي الطلبات', totalTx, 'Leads', 'text-gray-700', 'border-gray-400', 'bg-gray-100 text-gray-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>')}
                
                ${createClassicCard('نسبة التحويل', successRate + '%', '', 'text-indigo-600', 'border-indigo-500', 'bg-indigo-50 text-indigo-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>')}
                
                ${createClassicCard('متوسط السلة (AOV)', aov.toLocaleString(), 'MAD', 'text-cyan-600', 'border-cyan-500', 'bg-cyan-50 text-cyan-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>')}
                
                ${createClassicCard('تكلفة العميل (CPA)', cpa > 0 ? cpa.toFixed(0) : '-', 'MAD', 'text-pink-600', 'border-pink-500', 'bg-pink-50 text-pink-600', '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>')}
            `;
        }
    }

    // ============================================================
    // 6. Marketing & Demographics (إصلاح البيانات الجامدة)
    // ============================================================

    // (FIXED) دالة رسم شارت الخبرة (Experience)
    renderExperienceChart(dataSet) {
        if (!document.getElementById('experience-chart')) return;

        const counts = {};
        dataSet.forEach(item => {
            // تنظيف النص: إزالة الفراغات الزائدة وتوحيد الحالة
            let exp = (item.experience || 'غير محدد').trim();
            // ترجمة القيم المعروفة للعرض الأجمل
            if (exp === 'less_than_5') exp = '< 5 سنوات';
            if (exp === 'between_5_10') exp = '5-10 سنوات';
            if (exp === 'more_than_10') exp = '> 10 سنوات';

            counts[exp] = (counts[exp] || 0) + 1;
        });

        const labels = Object.keys(counts);
        const data = Object.values(counts);

        // ألوان جذابة ومتناسقة
        const colors = ['#6366F1', '#EC4899', '#14B8A6', '#F59E0B', '#9CA3AF'];

        this.renderChart('experience-chart', 'experience', 'pie', {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 1
            }]
        }, {
            plugins: { legend: { position: 'right', labels: { font: { family: 'Cairo' } } } },
            layout: { padding: 10 }
        });
    }

    // استبدال دالة renderCampaignsTable بالكامل في dashboard-merged-1.js

renderCampaignsTable(dataSet) {
    const tbody = document.getElementById('top-campaigns-body');
    if (!tbody) return;

    // 1. التجميع الهرمي (Hierarchical Aggregation)
    const campaignsMap = {};

    dataSet.forEach(item => {
        // تنظيف البيانات
        const campaignName = (item.utm_campaign && item.utm_campaign !== 'undefined') ? item.utm_campaign : 'Organic/Direct';
        const source = (item.utm_source && item.utm_source !== 'undefined') ? item.utm_source : 'Direct';
        const medium = (item.utm_medium && item.utm_medium !== 'undefined') ? item.utm_medium : '-';
        const content = (item.utm_content && item.utm_content !== 'undefined') ? item.utm_content : 'Not Specified';
        const term = (item.utm_term && item.utm_term !== 'undefined') ? item.utm_term : 'Not Specified';

        // مفتاح لدمج المصدر مع الوسيط (لضمان عدم الخلط)
        const sourceMediumKey = `${source} / ${medium}`;

        if (!campaignsMap[campaignName]) {
            campaignsMap[campaignName] = {
                id: 'cmp-' + Math.random().toString(36).substr(2, 9),
                name: campaignName,
                total: 0, paid: 0, revenue: 0,
                // مصفوفات التتبع التفصيلي
                sourceMediumStats: {}, // <-- الجديد: تتبع الأزواج (المصدر/الوسيط)
                contentStats: {}, 
                termStats: {}     
            };
        }

        const cmp = campaignsMap[campaignName];
        
        // تحديث الإجماليات
        cmp.total++;
        if (item.status === 'paid') {
            cmp.paid++;
            cmp.revenue += item.finalAmount;
        }

        // دالة مساعدة للتجميع (لتقليل تكرار الكود)
        const updateStat = (storageObj, key, isPaid, amount) => {
            if (!storageObj[key]) storageObj[key] = { count: 0, paid: 0, rev: 0 };
            storageObj[key].count++;
            if (isPaid) {
                storageObj[key].paid++;
                storageObj[key].rev += amount;
            }
        };

        // تجميع البيانات في الأقسام الثلاثة
        const isPaid = (item.status === 'paid');
        const amount = item.finalAmount;

        updateStat(cmp.sourceMediumStats, sourceMediumKey, isPaid, amount); // تجميع القنوات
        updateStat(cmp.contentStats, content, isPaid, amount);              // تجميع المحتوى
        updateStat(cmp.termStats, term, isPaid, amount);                    // تجميع الكلمات
    });

    // 2. الترتيب حسب الإيرادات
    let sortedCampaigns = Object.values(campaignsMap);
    sortedCampaigns.sort((a, b) => b.revenue - a.revenue);

    if (sortedCampaigns.length === 0) {
        this.clearCampaignsTable();
        return;
    }

    // 3. بناء الجدول (HTML)
    tbody.innerHTML = sortedCampaigns.map(c => {
        // --- تحضير البيانات الفرعية ---
        
        // 1. ترتيب المصادر/الوسائط
        const sortedSources = Object.entries(c.sourceMediumStats)
            .sort((a, b) => b[1].paid - a[1].paid);
        
        // المصدر الرئيسي للعرض في السطر العلوي
        const topSourceKey = sortedSources.length > 0 ? sortedSources[0][0] : 'Unknown';
        const otherSourcesCount = sortedSources.length - 1;
        const sourceDisplayLabel = otherSourcesCount > 0 
            ? `${topSourceKey} <span class="text-[9px] text-blue-500 font-bold">(+${otherSourcesCount} others)</span>` 
            : topSourceKey;

        // 2. ترتيب المحتوى
        const sortedContent = Object.entries(c.contentStats)
            .sort((a, b) => b[1].paid - a[1].paid)
            .filter(([k, v]) => k !== 'Not Specified' || v.paid > 0);

        // 3. ترتيب الكلمات
        const sortedTerms = Object.entries(c.termStats)
            .sort((a, b) => b[1].paid - a[1].paid)
            .filter(([k, v]) => k !== 'Not Specified' || v.paid > 0);

        // هل يوجد تفاصيل؟
        const hasDetails = sortedSources.length > 1 || sortedContent.length > 0 || sortedTerms.length > 0;
        
        // زر التوسيع
        const expandBtn = hasDetails 
            ? `<button onclick="document.getElementById('details-${c.id}').classList.toggle('hidden')" class="text-blue-600 hover:text-blue-800 transition-colors p-1 bg-blue-50 rounded-full hover:bg-blue-100">
                 <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
               </button>`
            : `<span class="w-6 h-6 block"></span>`;

        // دالة مساعدة لرسم الجداول الفرعية
        const renderSubTable = (title, icon, colorClass, dataRows) => `
            <div class="bg-white border rounded p-3 shadow-sm">
                <h5 class="text-xs font-bold ${colorClass} mb-2 flex items-center gap-1 border-b pb-1">
                    ${icon} ${title}
                </h5>
                <div class="overflow-y-auto max-h-40 scrollbar-thin">
                    <table class="w-full text-[10px] text-right">
                        <thead class="text-gray-400 bg-gray-50 sticky top-0">
                            <tr><th>البيان</th><th class="text-center">Leads</th><th class="text-center">Sales</th><th class="text-left dir-ltr">Rev</th></tr>
                        </thead>
                        <tbody class="divide-y">
                            ${dataRows.length ? dataRows.map(([name, stats]) => `
                            <tr class="hover:bg-gray-50">
                                <td class="py-1.5 px-2 font-mono text-gray-700 truncate max-w-[110px]" title="${this.sanitizeHTML(name)}">${this.sanitizeHTML(name)}</td>
                                <td class="py-1.5 px-2 text-center text-gray-500">${stats.count}</td>
                                <td class="py-1.5 px-2 text-center font-bold text-green-600">${stats.paid}</td>
                                <td class="py-1.5 px-2 text-left dir-ltr text-blue-600">${stats.rev.toLocaleString()}</td>
                            </tr>`).join('') : '<tr><td colspan="4" class="text-center text-gray-300 py-2">لا توجد بيانات</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // --- محتوى الصف التفصيلي (Accordion Body) ---
        const detailsRow = `
        <tr id="details-${c.id}" class="hidden bg-gray-50 border-b border-gray-200 shadow-inner">
            <td colspan="6" class="p-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    
                    ${renderSubTable(
                        'Sources & Channels', 
                        '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>', 
                        'text-blue-700', 
                        sortedSources
                    )}

                    ${renderSubTable(
                        'Ad Creatives', 
                        '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>', 
                        'text-purple-700', 
                        sortedContent
                    )}

                    ${renderSubTable(
                        'Keywords / Audience', 
                        '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/></svg>', 
                        'text-teal-700', 
                        sortedTerms
                    )}
                </div>
            </td>
        </tr>`;

        // --- الصف الرئيسي ---
        const campaignAOV = c.paid > 0 ? Math.round(c.revenue / c.paid) : 0;
        const convRate = c.total > 0 ? ((c.paid / c.total) * 100).toFixed(1) : 0;

        return `
        <tr class="border-b hover:bg-gray-50 transition-colors">
            <td class="px-4 py-3 align-top flex items-start gap-3">
                <div class="mt-1">${expandBtn}</div>
                <div class="flex flex-col">
                    <span class="font-bold text-gray-800 text-sm cursor-pointer hover:text-blue-600" onclick="document.getElementById('details-${c.id}').classList.toggle('hidden')">
                        ${this.sanitizeHTML(c.name)}
                    </span>
                    <span class="text-[10px] text-gray-500 font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded mt-1 w-fit shadow-sm">
                        ${sourceDisplayLabel}
                    </span>
                </div>
            </td>
            
            <td class="px-4 py-3 text-center align-middle">
                <div class="text-xs font-bold text-gray-700">${c.total}</div>
            </td>

            <td class="px-4 py-3 text-center align-middle">
                <div class="text-xs font-bold text-green-600">${c.paid}</div>
                <div class="text-[9px] text-green-400 font-mono">${convRate}% Conv.</div>
            </td>

            <td class="px-4 py-3 text-center align-middle">
                 <div class="text-xs text-blue-600 font-mono" dir="ltr">${campaignAOV.toLocaleString()}</div>
            </td>

            <td class="px-4 py-3 text-center align-middle bg-gray-50 font-bold text-blue-700 dir-ltr font-mono">
                ${c.revenue.toLocaleString()}
            </td>
        </tr>
        ${detailsRow}
        `;
    }).join('');
}

    clearCampaignsTable() {
        const tbody = document.getElementById('top-campaigns-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-400">لا توجد بيانات حملات لعرضها.</td></tr>`;
    }

    // دالة رسم الشارت العامة (Generic Chart Renderer)
    renderChart(canvasId, chartKey, type, data, extraOptions = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return; // حماية ضد الأخطاء إذا لم يوجد العنصر

        const ctx = canvas.getContext('2d');

        // تدمير الشارت القديم إذا وجد لتجنب تراكب الرسومات (Glitch)
        if (this.charts[chartKey]) {
            this.charts[chartKey].destroy();
        }

        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { family: 'Cairo' } } },
                tooltip: { titleFont: { family: 'Cairo' }, bodyFont: { family: 'Cairo' } }
            }
        };

        this.charts[chartKey] = new Chart(ctx, {
            type: type,
            data: data,
            options: { ...defaultOptions, ...extraOptions }
        });
    }

    // ============================================================
    // 7. Split Stats Cards (البطاقات المقسمة)
    // ============================================================
    renderSplitStatsCards(overall, filtered) {
        // تحديث العمود الأيمن (الإجمالي)
        this.renderRevCard('revenue-stats-breakdown', overall);
        this.renderSimpleCard('total-payments-stats', overall.totalTx, overall.cashplusCount, overall.cardCount, 'text-gray-900');
        this.renderSimpleCard('paid-payments-stats', overall.paidTx, overall.paid_cashplus, overall.paid_card, 'text-green-600');
        this.renderSimpleCard('pending-payments-stats', overall.pendingTx, 0, 0, 'text-yellow-600');
        this.renderSimpleCard('failed-payments-stats', overall.failedTx, 0, 0, 'text-red-600');
        this.renderSimpleCard('canceled-payments-stats', overall.canceledTx, 0, 0, 'text-gray-600');

        // تحديث العمود الأيسر (المفلتر)
        this.renderRevCard('filtered-revenue-stats-breakdown', filtered);
        this.renderSimpleCard('filtered-total-payments-stats', filtered.totalTx, filtered.cashplusCount, filtered.cardCount, 'text-gray-900');
        this.renderSimpleCard('filtered-paid-payments-stats', filtered.paidTx, filtered.paid_cashplus, filtered.paid_card, 'text-green-600');
        this.renderSimpleCard('filtered-pending-payments-stats', filtered.pendingTx, 0, 0, 'text-yellow-600');
        this.renderSimpleCard('filtered-failed-payments-stats', filtered.failedTx, 0, 0, 'text-red-600');
        this.renderSimpleCard('filtered-canceled-payments-stats', filtered.canceledTx, 0, 0, 'text-gray-600');
    }

    renderRevCard(id, s) {
        const el = document.getElementById(id);
        if (!el) return;

        // 1. الحسابات الأساسية للإجمالي والنسبة العامة
        const total = s.paidRevenue + s.pendingRevenue + s.failedRevenue + s.canceledRevenue;
        const pct = total > 0 ? ((s.paidRevenue / total) * 100).toFixed(1) : 0;

        // 2. حساب إجمالي الإيرادات المدفوعة من جميع القنوات
        const totalPaidMethods = (s.net_cashplus_revenue || 0) +
            (s.net_card_revenue || 0) +
            (s.net_cash_revenue || 0) +
            (s.net_bank_revenue || 0);

        // 3. حساب النسب المئوية لكل طريقة دفع
        const cpPercent = totalPaidMethods > 0 ? ((s.net_cashplus_revenue / totalPaidMethods) * 100).toFixed(1) : 0;
        const cardPercent = totalPaidMethods > 0 ? ((s.net_card_revenue / totalPaidMethods) * 100).toFixed(1) : 0;
        const cashPercent = totalPaidMethods > 0 ? ((s.net_cash_revenue / totalPaidMethods) * 100).toFixed(1) : 0;
        const bankPercent = totalPaidMethods > 0 ? ((s.net_bank_revenue / totalPaidMethods) * 100).toFixed(1) : 0;

        // 4. تنسيق الأرقام للعرض (أضفنا فواصل الآلاف)
        const fNet = s.paidRevenue.toLocaleString();
        const fPending = s.pendingRevenue.toLocaleString();
        const fFailed = s.failedRevenue.toLocaleString();
        const fCanceled = s.canceledRevenue.toLocaleString();

        const fCashplus = (s.net_cashplus_revenue || 0).toLocaleString();
        const fCard = (s.net_card_revenue || 0).toLocaleString();
        const fCash = (s.net_cash_revenue || 0).toLocaleString();
        const fBank = (s.net_bank_revenue || 0).toLocaleString();

        // 5. بناء HTML البطاقة
        el.innerHTML = `
        <div class="text-3xl font-bold text-green-600 mt-2" title="صافي الإيرادات المدفوعة">
            ${fNet} MAD 
            <span class="text-lg text-green-500">(${pct}%)</span>
        </div>
        
        <div class="mt-2 text-xs text-gray-500 space-y-1 border-t pt-2">
            <div class="flex justify-between"><span>معلق (Pending):</span> <span class="font-medium text-yellow-600">${fPending} MAD</span></div>
            <div class="flex justify-between"><span>فاشل (Failed):</span> <span class="font-medium text-red-600">${fFailed} MAD</span></div>
            <div class="flex justify-between"><span>ملغي (Canceled):</span> <span class="font-medium text-gray-400">${fCanceled} MAD</span></div>
        </div>

        <div class="mt-3 text-xs text-gray-600 border-t pt-2 bg-gray-50 p-2 rounded space-y-1">
            <div class="flex justify-between mb-2"><span class="text-sm font-bold text-gray-800">توزيع الإيرادات:</span></div>
            
            <div class="flex justify-between items-center">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-yellow-500"></span> كاش بلوس:</span> 
                <span class="font-medium">${fCashplus} MAD <span class="text-gray-400 text-[10px]">(${cpPercent}%)</span></span>
            </div>

            <div class="flex justify-between items-center">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-600"></span> بطاقة بنكية:</span> 
                <span class="font-medium">${fCard} MAD <span class="text-gray-400 text-[10px]">(${cardPercent}%)</span></span>
            </div>

            <div class="flex justify-between items-center">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-500"></span> نقد (Cash):</span> 
                <span class="font-medium">${fCash} MAD <span class="text-gray-400 text-[10px]">(${cashPercent}%)</span></span>
            </div>

            <div class="flex justify-between items-center">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-500"></span> تحويل بنكي:</span> 
                <span class="font-medium">${fBank} MAD <span class="text-gray-400 text-[10px]">(${bankPercent}%)</span></span>
            </div>
        </div>`;
    }

    renderSimpleCard(id, t, cp, card, color) {
        const el = document.getElementById(id);
        if (!el) return;
        const tm = cp + card;
        const breakdown = t > 0 ? `<div class="mt-2 text-xs text-gray-500"><div class="flex justify-between"><span>كاش بلوس:</span> <span>${cp}</span></div><div class="flex justify-between"><span>بطاقة بنكية:</span> <span>${card}</span></div></div>` : '';
        el.innerHTML = `<div class="text-3xl font-bold ${color} mt-2">${t}</div>${breakdown}`;
    }

    // ============================================================
    // 8. Table Renderer (جدول البيانات)
    // ============================================================
    // ============================================================
    // استبدل دالة renderTable بهذه النسخة المحدثة
    // ============================================================
    renderTable() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        const start = (this.currentPage - 1) * this.itemsPerPage;
        const paged = this.filteredData.slice(start, start + this.itemsPerPage);

        if (paged.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center p-10 text-gray-500">لا توجد بيانات مطابقة للبحث.</td></tr>`;
            this.updatePagination();
            return;
        }

        tbody.innerHTML = paged.map((item, idx) => {
            const globalIdx = start + idx;
            const statusInfo = this.getStatusInfo(item.status);
            const pm = (item.paymentMethod || '').toLowerCase();

            // --- منطق عرض طريقة الدفع الجديد ---
            let paymentMethodText = 'أخرى';
            let paymentCodeDisplay = '';

            if (pm === 'cashplus') {
                paymentMethodText = 'كاش بلوس';
                paymentCodeDisplay = `<div class="text-xs text-gray-500 font-mono mt-0.5">CP Code: ${item.cashplusCode || '-'}</div>`;
            } else if (pm === 'card' || pm === 'credit_card') {
                paymentMethodText = 'بطاقة ائتمانية';
                paymentCodeDisplay = `<div class="text-xs text-gray-500 font-mono mt-0.5">Card: **** ${item.last4 || '-'}</div>`;
            } else if (pm === 'cash') {
                paymentMethodText = '<span class="text-green-600 flex items-center justify-end gap-1">نقد (Cash) <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg></span>';
                // نستخدم cashplusCode الذي خزنا فيه الكود اليدوي
                paymentCodeDisplay = `<div class="text-xs text-gray-500 font-mono mt-0.5 bg-gray-100 rounded px-1 inline-block">${item.cashplusCode || '-'}</div>`;
            } else if (pm.includes('bank') || pm === 'virement') {
                paymentMethodText = '<span class="text-purple-600 flex items-center justify-end gap-1">تحويل بنكي <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg></span>';
                paymentCodeDisplay = `<div class="text-xs text-gray-500 font-mono mt-0.5 bg-gray-100 rounded px-1 inline-block">${item.cashplusCode || '-'}</div>`;
            }

            // دالة مساعدة صغيرة لإنشاء البطاقات (Chips)
const createBadge = (label, value, colorClass) => {
    if (!value || value === 'undefined') return '';
    // تقصير النصوص الطويلة جداً
    const cleanValue = this.sanitizeHTML(value); 
    const shortValue = cleanValue.length > 15 ? cleanValue.substring(0, 15) + '..' : cleanValue;
    
    return `
    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${colorClass} border border-opacity-20 border-gray-300 whitespace-nowrap" title="${label}: ${cleanValue}">
        <span class="opacity-50 mr-1">${label}:</span> ${shortValue}
    </span>`;
};

// تجميع البطاقات
let utmBadges = `
    <div class="flex flex-wrap gap-1.5 justify-start max-w-[200px]">
        ${createBadge('Camp', item.utm_campaign, 'bg-purple-50 text-purple-700')}
        ${createBadge('Src', item.utm_source, 'bg-blue-50 text-blue-700')}
        ${createBadge('Med', item.utm_medium, 'bg-indigo-50 text-indigo-700')}
        ${createBadge('Term', item.utm_term, 'bg-gray-50 text-gray-600')}
        ${createBadge('Cnt', item.utm_content, 'bg-pink-50 text-pink-700')}
    </div>
`;

// إذا لم تكن هناك أي بيانات تتبع، نعرض شرطة
if (!item.utm_campaign && !item.utm_source) utmBadges = '<span class="text-gray-300">-</span>';

            return `
        <tr class="hover:bg-gray-50 border-b transition-colors">
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${this.formatDate(item.timestamp)}</td>
            <td class="px-6 py-4">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusInfo.class}">${statusInfo.text}</span>
            </td>
            <td class="px-6 py-4 text-xs text-gray-500 font-mono">
                <div class="font-bold text-gray-700">${item.inquiryId}</div>
                ${item.transactionId ? `<div class="text-gray-400 mt-0.5 text-[10px]">${item.transactionId}</div>` : ''}
            </td>
            <td class="px-6 py-4 text-sm">
                <div class="font-bold text-gray-900 text-right">${this.sanitizeHTML(item.customerName)}</div>
                <div class="text-gray-500 text-xs text-right">${this.sanitizeHTML(item.customerEmail)}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 font-mono text-right" dir="ltr">${this.sanitizeHTML(item.customerPhone)}</td>
            <td class="px-6 py-4 text-sm font-medium text-gray-800 text-right">
                ${this.sanitizeHTML(item.normalizedCourse)}
                ${item.language ? `<span class="text-[10px] px-1 rounded bg-gray-200 text-gray-600 ml-1 uppercase">${item.language}</span>` : ''}
            </td>
            <td class="px-6 py-4 text-sm text-gray-500">${this.sanitizeHTML(item.qualification || '-')}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${this.sanitizeHTML(item.experience || '-')}</td>
            <td class="px-6 py-4 text-xs text-right" dir="ltr">${utmBadges}</td>
            <td class="px-6 py-4 text-sm font-bold text-gray-900 text-left" dir="ltr">MAD ${item.finalAmount}</td>
            <td class="px-6 py-4 text-sm text-right">
                <div class="font-bold text-gray-700">${paymentMethodText}</div>
                ${paymentCodeDisplay}
            </td>
            <td class="px-6 py-4 text-xs text-gray-400 text-right italic dir-ltr">
    ${this.sanitizeHTML(item.lastUpdatedBy || '-')}
</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-3">
                    <button onclick="dashboard.editRow(${globalIdx})" class="text-blue-500 hover:text-blue-700" title="تعديل">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button onclick="dashboard.showConfirmDelete(${globalIdx})" class="text-red-500 hover:text-red-700" title="حذف">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </td>
        </tr>`;
        }).join('');
        this.updatePagination();
        // هذا السطر هو الحل السحري للمشكلة
        this.applyPermissionsUI();
    }

    updatePagination() {
        const total = Math.max(1, Math.ceil(this.filteredData.length / this.itemsPerPage));
        const info = document.getElementById('page-info');
        if (info) info.textContent = `الصفحة ${this.currentPage} من ${total}`;

        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');

        if (prevBtn) prevBtn.disabled = this.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.currentPage === total;

        // إضافة تنسيق بصري للأزرار المعطلة
        [prevBtn, nextBtn].forEach(btn => {
            if (btn && btn.disabled) btn.classList.add('opacity-50', 'cursor-not-allowed');
            else if (btn) btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
    }

    changePage(dir) {
        this.currentPage += dir;
        this.renderTable();
    }

    // ============================================================
    // 9. Helpers & Utilities
    // ============================================================
    createCourseLookupMap() {
        // يمكن إضافة المزيد من التعيينات هنا إذا لزم الأمر
        return {};
    }

    normalizeCourseName(raw) {
        if (!raw) return 'غير محدد';
        const t = String(raw).trim().toLowerCase();
        if (t.includes('pmp')) return 'PMP';
        if (t.includes('planning')) return 'Planning';
        if (t.includes('qse')) return 'QSE';
        if (t.includes('soft')) return 'Soft Skills';
        return String(raw).trim();
    }

    parseDate(ts) {
        if (!ts) return null;
        // محاولة قراءة التاريخ القياسي
        let d = new Date(ts);
        if (!isNaN(d.getTime())) return d;

        // محاولة إصلاح التنسيقات غير القياسية (مثل: 2023-01-01 10 h 30 min)
        try {
            const cleaned = ts.replace(" h ", ":").replace(" min ", ":").replace(" s", "");
            d = new Date(cleaned);
            if (!isNaN(d.getTime())) return d;
        } catch (e) { }

        return null;
    }

    formatDate(ts) {
        // ... (باقي الكود لم يتغير)
        if (!ts) return "N/A";
        let date;
        const isoTest = new Date(ts);
        if (!isNaN(isoTest.getTime())) {
            date = isoTest;
        } else {
            let cleaned = ts.replace(" h ", ":").replace(" min ", ":").replace(" s", "");
            date = new Date(cleaned);
        }
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('ar-MA', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
        return ts;
    }

    getStatusInfo(s) {
        if (s === 'paid') return { text: 'مدفوع', class: 'bg-green-100 text-green-800' };
        if (s === 'pending' || s === 'pending_cashplus') return { text: 'معلق', class: 'bg-yellow-100 text-yellow-800' };
        if (s === 'failed') return { text: 'فاشل', class: 'bg-red-100 text-red-800' };
        if (s === 'canceled') return { text: 'ملغي', class: 'bg-gray-100 text-gray-600' };
        return { text: s, class: 'bg-gray-100 text-gray-800' };
    }

    sanitizeHTML(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    setLoadingState(isLoading) {
        const btn = document.getElementById('refresh-btn');
        if (btn) {
            if (isLoading) {
                btn.classList.add('animate-spin');
                btn.setAttribute('disabled', 'true');
            } else {
                btn.classList.remove('animate-spin');
                btn.removeAttribute('disabled');
            }
        }
    }

    // ============================================================
    // 10. Course Stats & Filters
    // ============================================================
    renderCourseStatistics(data) {
        const cont = document.getElementById('course-stats-container');
        if (!cont) return;

        const stats = {};
        data.forEach(i => {
            const c = i.normalizedCourse;
            if (!stats[c]) stats[c] = { total: 0, paid: 0, rev: 0 };
            stats[c].total++;
            if (i.status === 'paid') {
                stats[c].paid++;
                stats[c].rev += i.finalAmount;
            }
        });

        if (Object.keys(stats).length === 0) {
            cont.innerHTML = '<p class="col-span-full text-center text-gray-500">لا توجد بيانات كافية للإحصائيات.</p>';
            return;
        }

        cont.innerHTML = Object.entries(stats)
            .sort((a, b) => b[1].rev - a[1].rev)
            .map(([c, s]) => `
            <div class="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border-l-4 ${s.paid > 0 ? 'border-l-green-500' : 'border-l-gray-300'}">
                <div class="flex justify-between mb-3 items-center">
                    <span class="font-bold text-gray-800 text-sm truncate" title="${c}">${c}</span>
                    <span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-mono">${s.total} طلب</span>
                </div>
                <div class="text-xs text-gray-600 space-y-2">
                    <div class="flex justify-between"><span>مدفوع:</span> <span class="font-bold text-green-600">${s.paid}</span></div>
                    <div class="flex justify-between pt-2 border-t"><span>الإيراد:</span> <span class="font-bold text-gray-900 text-sm">${s.rev.toLocaleString()}</span></div>
                </div>
            </div>`).join('');
    }

    populateCourseFilterOptions(data) {
        const sel = document.getElementById('course-filter');
        if (!sel || sel.options.length > 1) return; // لا تفرغ القائمة إذا كانت ممتلئة بالفعل لتجنب الوميض

        const s = new Set(data.map(i => i.normalizedCourse));
        // ترتيب أبجدي
        const sortedCourses = Array.from(s).sort();

        sortedCourses.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            sel.appendChild(o);
        });
    }

    // ============================================================
    // 11. CRUD (Modals for Edit/Delete/Add)
    // ============================================================
    createModal(title, body, actions) {
        const c = document.getElementById('modal-container');
        if (!c) return;
        const id = `m-${Date.now()}`;
        c.innerHTML = `
        <div id="${id}" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 transition-opacity">
            <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full transform transition-all scale-100">
                <div class="p-5 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
                    <h3 class="font-bold text-lg text-gray-800">${title}</h3>
                    <button onclick="document.getElementById('${id}').remove()" class="text-gray-400 hover:text-red-500 transition-colors">✕</button>
                </div>
                <div class="p-6 overflow-y-auto max-h-[70vh]">${body}</div>
                <div class="p-5 bg-gray-50 flex justify-end gap-3 rounded-b-xl border-t">${actions}</div>
            </div>
        </div>`;
        return document.getElementById(id);
    }

    openEditUserModal(userStr) {
    const user = JSON.parse(decodeURIComponent(userStr));
    
    // محتوى المودال
    const h = `
    <form id="edit-user-form" class="space-y-4 text-right" dir="rtl">
        <div class="bg-gray-50 p-3 rounded border">
            <label class="block text-xs font-bold text-gray-500 mb-1">البريد الإلكتروني (للعرض فقط)</label>
            <input class="w-full p-2 border rounded bg-gray-200 text-gray-600 cursor-not-allowed" value="${user.email}" disabled>
        </div>

        <div class="grid grid-cols-2 gap-3">
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">الدور (Role)</label>
                <select id="edit-role" class="w-full p-2 border rounded bg-white" onchange="dashboard.toggleEditPermissions(this.value)">
                    <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">حالة الحساب</label>
                <select id="edit-frozen" class="w-full p-2 border rounded font-bold ${user.is_frozen ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}">
                    <option value="false" ${!user.is_frozen ? 'selected' : ''}>نشط (Active)</option>
                    <option value="true" ${user.is_frozen ? 'selected' : ''}>مجمد (Frozen)</option>
                </select>
            </div>
        </div>

        <div id="edit-perms-container" class="${user.role === 'super_admin' ? 'hidden' : ''} bg-white p-2 border rounded">
            <label class="text-xs font-bold text-gray-700 block mb-2">الصلاحيات التفصيلية:</label>
            <div class="flex gap-4">
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="edit-can-edit" class="rounded text-blue-600" ${user.can_edit ? 'checked' : ''}>
                    <span>تحديث البيانات</span>
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" id="edit-can-stats" class="rounded text-blue-600" ${user.can_view_stats ? 'checked' : ''}>
                    <span>رؤية الإحصائيات</span>
                </label>
            </div>
        </div>

        <hr class="border-gray-200 my-2">

        <details class="bg-yellow-50 p-2 rounded border border-yellow-200">
            <summary class="text-xs font-bold text-yellow-700 cursor-pointer">تغيير كلمة المرور (إعادة تعيين)</summary>
            <div class="mt-2">
                <input id="reset-password" type="text" placeholder="كلمة المرور الجديدة" class="w-full p-2 border rounded text-sm mb-2">
                <button type="button" id="btn-reset-pass" class="w-full bg-yellow-500 text-white text-xs font-bold py-1 rounded hover:bg-yellow-600">تحديث كلمة المرور فقط</button>
            </div>
        </details>
    </form>`;

    const act = `
    <button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200">إلغاء</button>
    <button id="btn-save-user" class="px-4 py-2 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700">حفظ التغييرات</button>
    `;

    const m = this.createModal('تعديل الموظف', h, act);

    // Helper to toggle visibility
    this.toggleEditPermissions = (val) => {
        const div = m.querySelector('#edit-perms-container');
        if (val === 'super_admin') div.classList.add('hidden');
        else div.classList.remove('hidden');
    };

    // 1. حفظ البيانات الأساسية (Role, Permissions, Freeze)
    m.querySelector('#btn-save-user').onclick = async () => {
        const btn = m.querySelector('#btn-save-user');
        btn.textContent = '...'; btn.disabled = true;

        const role = m.querySelector('#edit-role').value;
        const is_frozen = m.querySelector('#edit-frozen').value === 'true';
        const can_edit = m.querySelector('#edit-can-edit').checked;
        const can_view_stats = m.querySelector('#edit-can-stats').checked;

        try {
            const res = await fetch(`${this.API_URL}?action=update_user`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                body: JSON.stringify({ userId: user.id, role, is_frozen, can_edit, can_view_stats })
            });

            if (res.ok) {
                alert('تم تحديث بيانات الموظف بنجاح.');
                m.remove();
                // تحديث القائمة في المودال الأصلي (Settings Modal)
                const settingsList = document.querySelector('#users-list-body');
                if (settingsList) this.fetchUsersList(settingsList);
            } else {
                alert('فشل التحديث.');
            }
        } catch (e) { alert(e.message); }
        btn.textContent = 'حفظ التغييرات'; btn.disabled = false;
    };

    // 2. إعادة تعيين كلمة المرور
    m.querySelector('#btn-reset-pass').onclick = async () => {
        const newPass = m.querySelector('#reset-password').value;
        if (!newPass || newPass.length < 6) return alert('كلمة المرور قصيرة جداً');

        if (!confirm('هل أنت متأكد من تغيير كلمة المرور لهذا الموظف؟')) return;

        try {
            const res = await fetch(`${this.API_URL}?action=change_password`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                // نرسل userId ليعرف الباكند أننا نغير لمستخدم آخر
                body: JSON.stringify({ newPassword: newPass, userId: user.id })
            });
            
            if (res.ok) {
                alert('تم تغيير كلمة المرور.');
                m.querySelector('#reset-password').value = '';
            } else {
                const d = await res.json();
                alert('خطأ: ' + (d.error || 'فشل'));
            }
        } catch (e) { alert(e.message); }
    };
}

    showConfirmDelete(idx) {
        const item = this.filteredData[idx];
        if (!item) return;
        const act = `<button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">إلغاء</button>
                     <button id="del-confirm" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition shadow">نعم، احذف</button>`;
        const m = this.createModal('تأكيد الحذف', `هل أنت متأكد تماماً من حذف المعاملة الخاصة بالعميل: <br/><b>${this.sanitizeHTML(item.customerName)}</b>؟<br/><span class="text-red-500 text-sm">لا يمكن التراجع عن هذا الإجراء.</span>`, act);

        m.querySelector('#del-confirm').onclick = async () => {
            const btn = m.querySelector('#del-confirm');
            btn.textContent = 'جاري الحذف...';
            btn.disabled = true;
            await this.doDelete(item.inquiryId || item.transactionId);
            m.remove();
        };
    }

    async doDelete(id) {
        try {
            const res = await fetch(this.API_URL, {
                method: 'DELETE',
                headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                this.fetchAllData();
            } else {
                alert('فشل الحذف، يرجى المحاولة لاحقاً.');
            }
        } catch (e) { alert('حدث خطأ أثناء الاتصال بالسيرفر.'); }
    }

    editRow(idx) {
        const item = this.filteredData[idx];
        const s = (v) => v || ''; // دالة مساعدة للنصوص الفارغة

        // 1. تعريف الخيارات (مطابقة تماماً للإضافة اليدوية)
        const coursesOptions = [
            { val: 'PMP', label: 'PMP (إدارة المشاريع)' },
            { val: 'Planning', label: 'Planning (تخطيط المواقع)' },
            { val: 'QSE', label: 'QSE (الجودة والسلامة)' },
            { val: 'Soft Skills', label: 'Soft Skills (المهارات الناعمة)' }
        ];
        const languages = [
            { val: 'fr', label: 'Français' },
            { val: 'ar', label: 'العربية' },
            { val: 'en', label: 'English' }
        ];
        const qualifications = [
            { val: 'Technicien', label: 'Technicien' },
            { val: 'Ingénieur', label: 'Ingénieur' },
            { val: 'Master', label: 'Master' },
            { val: 'License', label: 'License' },
            { val: 'Autre', label: 'Autre' }
        ];
        const experiences = [
            { val: 'less_than_5', label: 'أقل من 5 سنوات' },
            { val: 'between_5_10', label: 'بين 5 و 10 سنوات' },
            { val: 'more_than_10', label: 'أكثر من 10 سنوات' }
        ];

        // 2. بناء النموذج (HTML) مع تحديد القيم المحفوظة (selected logic)
        const h = `
        <form id="e-form" class="space-y-3 text-right" dir="rtl">
            <div class="bg-yellow-50 p-2 rounded text-xs text-gray-600 mb-2 border border-yellow-200">
                تعديل السجل رقم: <b class="font-mono">${item.inquiryId}</b>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <div><label class="text-xs font-bold text-gray-500">الاسم</label><input class="border p-2 w-full rounded focus:ring-1 focus:ring-blue-500" name="customerName" value="${s(item.customerName)}"></div>
                <div><label class="text-xs font-bold text-gray-500">الهاتف</label><input class="border p-2 w-full rounded focus:ring-1 focus:ring-blue-500 text-left" dir="ltr" name="customerPhone" value="${s(item.customerPhone)}"></div>
            </div>
            <div><label class="text-xs font-bold text-gray-500">الإيميل</label><input class="border p-2 w-full rounded focus:ring-1 focus:ring-blue-500 text-left" dir="ltr" name="customerEmail" value="${s(item.customerEmail)}"></div>
            
            <div class="grid grid-cols-2 gap-3 bg-gray-50 p-2 rounded border">
                <div>
                    <label class="text-xs font-bold text-gray-500">الدورة</label>
                    <select class="border p-2 w-full rounded bg-white" name="course">
                        ${coursesOptions.map(c => `<option value="${c.val}" ${item.normalizedCourse === c.val ? 'selected' : ''}>${c.label}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500">اللغة</label>
                    <select class="border p-2 w-full rounded bg-white" name="language">
                        ${languages.map(l => `<option value="${l.val}" ${item.language === l.val ? 'selected' : ''}>${l.label}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500">المؤهل</label>
                    <select class="border p-2 w-full rounded bg-white" name="qualification">
                        <option value="" disabled>-- غير محدد --</option>
                        ${qualifications.map(q => `<option value="${q.val}" ${item.qualification === q.val ? 'selected' : ''}>${q.label}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500">الخبرة</label>
                    <select class="border p-2 w-full rounded bg-white" name="experience">
                        <option value="" disabled>-- غير محدد --</option>
                        ${experiences.map(e => `<option value="${e.val}" ${item.experience === e.val ? 'selected' : ''}>${e.label}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3 bg-blue-50 p-2 rounded border border-blue-100">
                <div>
                    <label class="text-xs font-bold text-blue-800">طريقة الدفع</label>
                    <select class="border p-2 w-full rounded bg-white" name="paymentMethod">
                        <option value="cash" ${item.paymentMethod === 'cash' ? 'selected' : ''}>نقد (Cash)</option>
                        <option value="bank_transfer" ${item.paymentMethod === 'bank_transfer' ? 'selected' : ''}>تحويل بنكي</option>
                        <option value="cashplus" ${item.paymentMethod === 'cashplus' ? 'selected' : ''}>CashPlus</option>
                        <option value="card" ${item.paymentMethod === 'card' ? 'selected' : ''}>Credit Card</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-blue-800">الحالة</label>
                    <select class="border p-2 w-full rounded bg-white" name="status">
                        <option value="paid" ${item.status === 'paid' ? 'selected' : ''}>Paid (مدفوع)</option>
                        <option value="pending" ${item.status === 'pending' ? 'selected' : ''}>Pending (معلق)</option>
                        <option value="failed" ${item.status === 'failed' ? 'selected' : ''}>Failed (فاشل)</option>
                        <option value="canceled" ${item.status === 'canceled' ? 'selected' : ''}>Canceled (ملغي)</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-600">Trans. ID / Receipt</label>
                    <input class="border p-2 w-full rounded font-mono text-sm" name="transactionId" value="${s(item.transactionId)}">
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-600">المبلغ (MAD)</label>
                    <input class="border p-2 w-full rounded font-bold" name="finalAmount" type="number" value="${s(item.finalAmount)}">
                </div>
            </div>

            <details class="border rounded p-2 bg-white mt-2">
                <summary class="text-xs font-bold cursor-pointer text-gray-400 uppercase hover:text-blue-500">تعديل بيانات التتبع (Tracking Data)</summary>
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <input class="border p-2 rounded text-xs" name="utm_source" placeholder="Source" value="${s(item.utm_source)}">
                    <input class="border p-2 rounded text-xs" name="utm_medium" placeholder="Medium" value="${s(item.utm_medium)}">
                    <input class="border p-2 rounded text-xs" name="utm_campaign" placeholder="Campaign" value="${s(item.utm_campaign)}">
                    <input class="border p-2 rounded text-xs" name="utm_content" placeholder="Content" value="${s(item.utm_content)}">
                </div>
            </details>
        </form>`;

        const act = `<button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 text-sm transition">إلغاء</button>
                 <button id="save-edit-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shadow text-sm font-bold transition flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    حفظ التعديلات
                 </button>`;

        const m = this.createModal('تعديل المعاملة (Full Edit)', h, act);

        // منطق الحفظ (كما هو، لا يحتاج لتغيير لأن FormData يسحب القيم من Selects تلقائياً)
        m.querySelector('#save-edit-btn').onclick = async () => {
            const btn = m.querySelector('#save-edit-btn');
            btn.textContent = 'جاري الحفظ...'; btn.disabled = true;

            const fd = new FormData(m.querySelector('#e-form'));
            const payload = {
                originalInquiryId: item.inquiryId,
                ...Object.fromEntries(fd)
            };

            try {
                const res = await fetch(this.API_URL, {
                    method: 'PUT',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    m.remove();
                    this.fetchAllData();
                } else {
                    alert("فشل حفظ التعديلات.");
                    btn.disabled = false;
                    btn.textContent = 'حفظ التعديلات';
                }
            } catch (e) {
                alert(e.message);
                btn.disabled = false;
                btn.textContent = 'حفظ التعديلات';
            }
        };
    }

    // ============================================================
    // استبدل دالة showAddModal القديمة بهذه النسخة الجديدة كلياً
    // ============================================================
    showAddModal() {
        // 1. تعريف القوائم المنسدلة (Dropdown Options)
        const coursesOptions = [
            { val: 'PMP', label: 'PMP (إدارة المشاريع)' },
            { val: 'Planning', label: 'Planning (تخطيط المواقع)' },
            { val: 'QSE', label: 'QSE (الجودة والسلامة)' },
            { val: 'Soft Skills', label: 'Soft Skills (المهارات الناعمة)' }
        ];

        const languages = [
            { val: 'fr', label: 'Français (الفرنسية)' },
            { val: 'ar', label: 'العربية (Arabic)' },
            { val: 'en', label: 'English (الإنجليزية)' }
        ];

        const qualifications = [
            { val: 'Technicien', label: 'Technicien (تقني)' },
            { val: 'Ingénieur', label: 'Ingénieur (مهندس)' },
            { val: 'Master', label: 'Master (ماستر)' },
            { val: 'License', label: 'License (إجازة)' },
            { val: 'Autre', label: 'Autre (آخر)' }
        ];

        const experiences = [
            { val: 'less_than_5', label: 'أقل من 5 سنوات' },
            { val: 'between_5_10', label: 'بين 5 و 10 سنوات' },
            { val: 'more_than_10', label: 'أكثر من 10 سنوات' }
        ];

        // 2. بناء واجهة النموذج (HTML Construction)
        const h = `
        <form id="add-form" class="space-y-5 text-right" dir="rtl">
            
            <div class="bg-white p-3 rounded-lg border border-gray-200">
                <h4 class="text-xs font-bold text-blue-600 mb-3 border-b pb-1">بيانات العميل</h4>
                <div class="grid grid-cols-2 gap-4 mb-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">الاسم الكامل <span class="text-red-500">*</span></label>
                        <input class="border border-gray-300 p-2 w-full rounded focus:ring-1 focus:ring-blue-500" name="customerName" required placeholder="الاسم">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">الهاتف <span class="text-red-500">*</span></label>
                        <input class="border border-gray-300 p-2 w-full rounded focus:ring-1 focus:ring-blue-500 text-left" dir="ltr" name="customerPhone" required placeholder="06...">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">البريد الإلكتروني <span class="text-red-500">*</span></label>
                    <input class="border border-gray-300 p-2 w-full rounded focus:ring-1 focus:ring-blue-500 text-left" dir="ltr" name="customerEmail" type="email" required placeholder="email@example.com">
                </div>
            </div>

            <div class="bg-white p-3 rounded-lg border border-gray-200">
                <h4 class="text-xs font-bold text-blue-600 mb-3 border-b pb-1">تفاصيل الدورة والمؤهلات</h4>
                <div class="grid grid-cols-2 gap-4 mb-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">الدورة التدريبية <span class="text-red-500">*</span></label>
                        <select class="border border-gray-300 p-2 w-full rounded bg-white" name="courseBase" required>
                            ${coursesOptions.map(c => `<option value="${c.val}">${c.label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">لغة التدريس</label>
                        <select class="border border-gray-300 p-2 w-full rounded bg-white" name="courseLang">
                            ${languages.map(l => `<option value="${l.val}">${l.label}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">المؤهل العلمي</label>
                        <select class="border border-gray-300 p-2 w-full rounded bg-white" name="qualification">
                            <option value="" disabled selected>-- اختر --</option>
                            ${qualifications.map(q => `<option value="${q.val}">${q.label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">سنوات الخبرة</label>
                        <select class="border border-gray-300 p-2 w-full rounded bg-white" name="experience">
                            <option value="" disabled selected>-- اختر --</option>
                            ${experiences.map(e => `<option value="${e.val}">${e.label}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h4 class="text-xs font-bold text-blue-800 mb-3 border-b border-blue-200 pb-1">بيانات الدفع والمعاملة</h4>
                
                <div class="grid grid-cols-2 gap-4 mb-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">طريقة الدفع</label>
                        <select id="manual-payment-method" class="border border-gray-300 p-2 w-full rounded bg-white focus:ring-1 focus:ring-blue-500" name="paymentMethod">
                            <option value="cash">نقد (Cash)</option>
                            <option value="bank_transfer">تحويل بنكي (Virement)</option>
                            <option value="cashplus">CashPlus</option>
                            <option value="card">بطاقة بنكية (Card)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">حالة الدفع</label>
                        <select id="manual-status" class="border border-gray-300 p-2 w-full rounded bg-white focus:ring-1 focus:ring-blue-500" name="status">
                            <option value="paid">مدفوع (Paid)</option>
                            <option value="pending">معلق (Pending)</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 items-start">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">المبلغ (MAD) <span class="text-red-500">*</span></label>
                        <input class="border border-gray-300 p-2 w-full rounded focus:ring-1 focus:ring-blue-500" name="finalAmount" type="number" required placeholder="0.00">
                    </div>
                    
                    <div id="transaction-input-container">
                        <label class="block text-xs font-medium text-gray-600 mb-1" id="tx-label">رقم الإيصال / المرجع</label>
                        <input id="manual-tx-id" class="border border-gray-300 p-2 w-full rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="أدخل الرقم هنا">
                        
                        <div id="auto-tx-msg" class="hidden text-xs text-orange-600 mt-2 font-semibold flex items-center gap-1">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>
                            سيتم إنشاء معرف تلقائي
                        </div>
                    </div>
                </div>
            </div>

            <details class="border border-gray-200 rounded-lg bg-gray-50">
                <summary class="p-3 text-xs font-bold text-gray-500 cursor-pointer hover:bg-gray-100 flex justify-between items-center">
                    <span>بيانات التتبع والمصدر (UTM Tracking)</span>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </summary>
                <div class="p-3 border-t border-gray-200 grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] text-gray-400 uppercase">Source</label>
                        <input class="border p-2 w-full rounded text-xs" name="utm_source" placeholder="ex: manual_entry, whatsapp" value="manual_entry">
                    </div>
                    <div>
                        <label class="block text-[10px] text-gray-400 uppercase">Medium</label>
                        <input class="border p-2 w-full rounded text-xs" name="utm_medium" placeholder="ex: offline, phone">
                    </div>
                    <div>
                        <label class="block text-[10px] text-gray-400 uppercase">Campaign</label>
                        <input class="border p-2 w-full rounded text-xs" name="utm_campaign" placeholder="Campaign Name">
                    </div>
                    <div>
                        <label class="block text-[10px] text-gray-400 uppercase">Content/Note</label>
                        <input class="border p-2 w-full rounded text-xs" name="utm_content" placeholder="Any notes...">
                    </div>
                </div>
            </details>

        </form>`;

        // 3. أزرار التحكم
        const act = `
        <button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition">إلغاء</button>
        <button id="add-save" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow font-bold flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
            حفظ المعاملة
        </button>`;

        const m = this.createModal('إضافة معاملة جديدة (New Transaction)', h, act);

        // 4. المنطق التفاعلي (Logic & Event Listeners)
        const statusSelect = m.querySelector('#manual-status');
        const paymentSelect = m.querySelector('#manual-payment-method');
        const txInput = m.querySelector('#manual-tx-id');
        const autoMsg = m.querySelector('#auto-tx-msg');
        const txLabel = m.querySelector('#tx-label');

        // دالة تحديث الواجهة بناءً على المدخلات
        const updateUI = () => {
            const isPaid = statusSelect.value === 'paid';
            const method = paymentSelect.value;

            // منطق الكاش والتحويل البنكي
            if (method === 'cash' || method === 'bank_transfer') {
                if (isPaid) {
                    // إذا كانت الحالة "مدفوع"، يجب إدخال رقم الإيصال
                    txInput.classList.remove('hidden');
                    autoMsg.classList.add('hidden');
                    txInput.required = true;

                    // تغيير النص التوضيحي حسب الطريقة
                    if (method === 'cash') {
                        txInput.placeholder = 'رقم إيصال النقد (مثلاً: 501)';
                        txLabel.textContent = 'رقم الإيصال (Receipt No)';
                    } else {
                        txInput.placeholder = 'رقم/مرجع التحويل البنكي';
                        txLabel.textContent = 'مرجع التحويل (Ref No)';
                    }
                } else {
                    // إذا كانت الحالة "معلق"، يتم التوليد تلقائياً
                    txInput.classList.add('hidden');
                    autoMsg.classList.remove('hidden');
                    txInput.required = false;
                    txLabel.textContent = 'معرف المعاملة (System ID)';
                }
            } else {
                // للطرق الأخرى (كاش بلوس، بطاقة) - نترك المجال للإدخال اليدوي دائماً
                txInput.classList.remove('hidden');
                autoMsg.classList.add('hidden');
                txInput.placeholder = 'Transaction ID / Code';
                txLabel.textContent = 'معرف المعاملة';
                txInput.required = false;
            }
        };

        // تفعيل التحديث عند تغيير القيم
        statusSelect.addEventListener('change', updateUI);
        paymentSelect.addEventListener('change', updateUI);
        updateUI(); // التشغيل الأولي

        // 5. منطق الحفظ والإرسال
        m.querySelector('#add-save').onclick = async () => {
            const form = m.querySelector('#add-form');

            // التحقق من الصحة (Validation)
            if (!form.checkValidity() || (statusSelect.value === 'paid' && !txInput.hidden && !txInput.value)) {
                alert('الرجاء ملء جميع الحقول المطلوبة (خاصة رقم الإيصال في حالة الدفع).');
                return;
            }

            const btn = m.querySelector('#add-save');
            btn.textContent = 'جاري المعالجة...';
            btn.disabled = true;

            const fd = new FormData(form);

            // إعداد المتغيرات لتوليد الأكواد
            const method = paymentSelect.value;
            const isPaid = statusSelect.value === 'paid';
            const randomPart = Math.floor(1000 + Math.random() * 9000); // رقم عشوائي

            // --- منطق توليد المعرفات (Smart ID Generation) ---
            let finalTxId = '';
            let finalDisplayCode = '';

            if (method === 'cash') {
                if (isPaid) {
                    finalTxId = `CS-REC-${txInput.value}`; // معرف فريد للنظام
                    finalDisplayCode = `CS-${txInput.value}`; // كود قصير للعرض
                } else {
                    finalTxId = `CS-PEND-${randomPart}`;
                    finalDisplayCode = `CS-TMP-${randomPart}`;
                }
            } else if (method === 'bank_transfer') {
                if (isPaid) {
                    finalTxId = `BANK-TRF-${txInput.value}`;
                    finalDisplayCode = `BK-${txInput.value}`;
                } else {
                    finalTxId = `BANK-PEND-${randomPart}`;
                    finalDisplayCode = `BK-TMP-${randomPart}`;
                }
            } else {
                // للحالات الأخرى
                finalTxId = txInput.value || `MANUAL-${randomPart}`;
                finalDisplayCode = txInput.value || '-';
            }

            // بناء الكائن للإرسال (Payload)
            const payload = {
                // الحقول الأساسية
                customerName: fd.get('customerName'),
                customerPhone: fd.get('customerPhone'),
                customerEmail: fd.get('customerEmail'),

                // تفاصيل الدورة
                course: fd.get('courseBase'),
                language: fd.get('courseLang'),
                qualification: fd.get('qualification'),
                experience: fd.get('experience'),

                // تفاصيل الدفع
                status: fd.get('status'),
                finalAmount: fd.get('finalAmount'),
                paymentMethod: method,

                // المعرفات المولدة
                transactionId: finalTxId,
                cashplusCode: finalDisplayCode, // نستخدم هذا الحقل لعرض الكود المختصر في الجدول
                last4: (method === 'card') ? (txInput.value || 'XXXX') : '',

                // حقول النظام والتتبع
                inquiryId: `MANUAL-${Date.now()}`,
                utm_source: fd.get('utm_source'),
                utm_medium: fd.get('utm_medium'),
                utm_campaign: fd.get('utm_campaign'),
                utm_content: fd.get('utm_content'),
                utm_term: ''
            };

            // الإرسال للسيرفر
            try {
                const response = await fetch(this.API_URL, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error('فشل في الحفظ');

                m.remove();
                this.fetchAllData(); // تحديث الجدول فوراً
            } catch (e) {
                alert('حدث خطأ أثناء الحفظ: ' + e.message);
                btn.disabled = false;
                btn.textContent = 'حفظ المعاملة';
            }
        };
    }

    // ============================================================
    // 12. Authentication & Session
    // ============================================================
    getAuthHeaders() {
        const token = sessionStorage.getItem('admin_token');
        const type = sessionStorage.getItem('auth_type');
        const basic = sessionStorage.getItem('basic_cred');

        // إذا كان الدخول عبر Supabase
        if (type === 'supabase' && token) {
            return { 'Authorization': 'Bearer ' + token };
        }
        
        // إذا كان الدخول عبر الباب الخلفي (Backdoor)
        if (type === 'backdoor' && basic) {
            return { 'Authorization': 'Basic ' + basic };
        }

        // محاولة افتراضية (Legacy)
        if (token && !type) {
             return { 'Authorization': 'Basic ' + token }; 
        }
        
        return {};
    }

    // ============================================================
    // 13. Settings & User Management (NEW)
    // ============================================================
    
    openSettingsModal() {
    const template = document.getElementById('settings-modal-template').content.cloneNode(true);
    
    // إنشاء المودال
    const m = document.createElement('div');
    m.id = 'settings-modal-wrapper';
    
    // (تصحيح الخطأ هنا: دمجنا كل HTML في سلسلة واحدة نظيفة)
    m.innerHTML = `
    <div class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full transform transition-all">
            <div class="p-5 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
                <h3 class="font-bold text-lg text-gray-800">الإعدادات وإدارة النظام</h3>
                <button onclick="document.getElementById('settings-modal-wrapper').remove()" class="text-gray-400 hover:text-red-500">✕</button>
            </div>
            <div class="p-6" id="settings-body"></div>
        </div>
    </div>`;
    
    // إدراج محتوى التمبلت الأساسي
    const body = m.querySelector('#settings-body');
    body.appendChild(template);

    // إضافة خيارات الصلاحيات (Checkboxes) ديناميكياً داخل قسم المستخدمين
    // نبحث عن المكان المناسب لإدخال الخيارات الجديدة
    const usersContent = body.querySelector('#content-users .bg-gray-50');
    
    if (usersContent) {
        // إضافة HTML الخاص بالصلاحيات
        const roleSelectContainer = usersContent.querySelector('#new-user-role').parentElement;
            roleSelectContainer.innerHTML = `
                <label class="text-xs text-gray-500 block mb-1">الصلاحية (Role)</label>
                <select id="new-user-role" class="w-full p-2 border rounded text-sm bg-white" onchange="dashboard.togglePermissions(this.value)">
                    <option value="editor">Editor (محرر - صلاحيات محدودة)</option>
                    <option value="super_admin">Super Admin (مدير - صلاحيات كاملة)</option>
                </select>
            `;

            // 2. إضافة HTML الخاص بالصلاحيات (Checkboxes)
            const permissionsHTML = `
            <div id="permissions-checks" class="bg-white p-2 border rounded mt-2 transition-all duration-300">
                <label class="text-xs font-bold text-gray-700 block mb-2">صلاحيات إضافية (للمحررين):</label>
                <div class="flex gap-4">
                    <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input type="checkbox" id="perm-edit" class="rounded text-blue-600 focus:ring-blue-500" checked>
                        <span>تحديث البيانات (Edit)</span>
                    </label>
                    <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input type="checkbox" id="perm-stats" class="rounded text-blue-600 focus:ring-blue-500">
                        <span>رؤية الإحصائيات المالية</span>
                    </label>
                </div>
            </div>`;
            usersContent.insertAdjacentHTML('beforeend', permissionsHTML);
        }
        
        // إدراج محتوى التمبلت داخل جسم المودال
        m.querySelector('#settings-body').appendChild(template);
        document.getElementById('modal-container').appendChild(m);

        // ربط الأحداث (Tabs Logic)
        const tabUsers = m.querySelector('#tab-users');
        const tabPass = m.querySelector('#tab-password');
        const contentUsers = m.querySelector('#content-users');
        const contentPass = m.querySelector('#content-password');

        tabUsers.onclick = () => {
            tabUsers.classList.add('border-b-2', 'border-blue-600', 'text-blue-600');
            tabUsers.classList.remove('text-gray-500');
            tabPass.classList.remove('border-b-2', 'border-blue-600', 'text-blue-600');
            tabPass.classList.add('text-gray-500');
            contentUsers.classList.remove('hidden');
            contentPass.classList.add('hidden');
        };

        tabPass.onclick = () => {
            tabPass.classList.add('border-b-2', 'border-blue-600', 'text-blue-600');
            tabPass.classList.remove('text-gray-500');
            tabUsers.classList.remove('border-b-2', 'border-blue-600', 'text-blue-600');
            tabUsers.classList.add('text-gray-500');
            contentPass.classList.remove('hidden');
            contentUsers.classList.add('hidden');
        };

        // تحميل قائمة المستخدمين فور الفتح
        this.fetchUsersList(m.querySelector('#users-list-body'));

        // زر إضافة مستخدم
        m.querySelector('#btn-add-user').onclick = () => this.handleAddUser(m);

        // زر تغيير الباسورد
        m.querySelector('#btn-save-pass').onclick = () => this.handleChangePassword(m);
    }

    // دالة للتحكم في ظهور خيارات الصلاحيات حسب الدور المختار
    togglePermissions(role) {
        const checksDiv = document.getElementById('permissions-checks');
        if (!checksDiv) return;

        if (role === 'super_admin') {
            // إخفاء الخيارات لأن المدير يملك كل الصلاحيات
            checksDiv.classList.add('hidden');
            // (اختياري) تعطيل الـ checkboxes لضمان عدم إرسال قيم خاطئة
            checksDiv.querySelectorAll('input').forEach(i => i.disabled = true);
        } else {
            // إظهار الخيارات للمحرر
            checksDiv.classList.remove('hidden');
            checksDiv.querySelectorAll('input').forEach(i => i.disabled = false);
        }
    }

    async fetchUsersList(tbody) {
    try {
        const res = await fetch(`${this.API_URL}?action=get_users`, { 
            method: 'GET',
            headers: this.getAuthHeaders()
        });
        
        if (!res.ok) throw new Error('فشل جلب المستخدمين');
        const { data } = await res.json();
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center">لا يوجد مستخدمين.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(u => {
            // تنسيق الصف إذا كان مجمداً
            const rowClass = u.is_frozen ? 'bg-red-50' : 'hover:bg-gray-50';
            const statusBadge = u.is_frozen 
                ? '<span class="px-2 py-0.5 rounded text-[10px] bg-red-200 text-red-800 font-bold">مجمد</span>' 
                : '<span class="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-800">نشط</span>';

            // نقوم بتخزين بيانات المستخدم في الزر لتسهيل التعديل
            // ملاحظة: نستخدم escape لتجنب مشاكل الاقتباسات
            const userDataStr = encodeURIComponent(JSON.stringify(u));

            return `
            <tr class="${rowClass} border-b transition-colors">
                <td class="p-3 text-gray-800 font-mono text-xs">
                    <div>${u.email}</div>
                    <div class="text-[10px] text-gray-500 mt-1">${u.role}</div>
                </td>
                <td class="p-3 text-center">${statusBadge}</td>
                <td class="p-3 text-center">
                    <div class="flex justify-center gap-2">
                        <button onclick="dashboard.openEditUserModal('${userDataStr}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold bg-blue-50 px-2 py-1 rounded border border-blue-200">
                            تعديل / تجميد
                        </button>
                        <button onclick="dashboard.handleDeleteUserAction('${u.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold bg-white px-2 py-1 rounded border border-red-200" title="حذف نهائي">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">خطأ: ${e.message}</td></tr>`;
    }
}

    async handleAddUser(modal) {
    const email = modal.querySelector('#new-user-email').value;
    const password = modal.querySelector('#new-user-pass').value;
    // قراءة الدور المختار
    const role = modal.querySelector('#new-user-role').value; 
    const btn = modal.querySelector('#btn-add-user');
    const can_edit = modal.querySelector('#perm-edit').checked;
    const can_view_stats = modal.querySelector('#perm-stats').checked;

    if (!email || !password) return alert('المرجو إدخال البريد وكلمة المرور');

    btn.textContent = '...'; btn.disabled = true;

    try {
        // إرسال الدور (role) مع البيانات
        const res = await fetch(`${this.API_URL}?action=add_user`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
body: JSON.stringify({ email, password, role, can_edit, can_view_stats })        });

            const result = await res.json();
            if (res.ok) {
                alert('تمت إضافة الموظف بنجاح');
                modal.querySelector('#new-user-email').value = '';
                modal.querySelector('#new-user-pass').value = '';
                this.fetchUsersList(modal.querySelector('#users-list-body'));
            } else {
                alert('خطأ: ' + (result.error?.message || result.error || 'غير معروف'));
            }
        } catch (e) {
            alert('فشل الاتصال: ' + e.message);
        } finally {
            btn.textContent = 'إضافة'; btn.disabled = false;
        }
    }

    async handleDeleteUserAction(userId) {
        if (!confirm('هل أنت متأكد من حذف هذا الموظف؟ سيتم منعه من الدخول فوراً.')) return;

        try {
        // التعديل هنا: استخدام ?action=delete_user بدلاً من /delete-user
        const res = await fetch(`${this.API_URL}?action=delete_user`, {
            method: 'DELETE', // أو POST إذا فضلت، لكن DELETE مقبول
            headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
            body: JSON.stringify({ userId })
        });
            
            if (res.ok) {
                // إعادة تحديث الجدول الموجود في المودال المفتوح حالياً
                const modalBody = document.querySelector('#users-list-body');
                if (modalBody) this.fetchUsersList(modalBody);
            } else {
                alert('فشل الحذف');
            }
        } catch (e) { alert(e.message); }
    }

    async handleChangePassword(modal) {
        const newPassword = modal.querySelector('#change-new-pass').value;
        if (!newPassword || newPassword.length < 6) return alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل');

        if (!confirm('هل أنت متأكد؟ سيتم تسجيل الخروج.')) return;

        try {
        // التعديل هنا: استخدام ?action=change_password
        const res = await fetch(`${this.API_URL}?action=change_password`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
            body: JSON.stringify({ newPassword })
        });

            if (res.ok) {
                alert('تم تغيير كلمة المرور بنجاح. يرجى الدخول مجدداً.');
                this.logout();
            } else {
                const d = await res.json();
                alert('خطأ: ' + (d.error?.message || d.error));
            }
        } catch (e) { alert(e.message); }
    }

    checkAuth() {
        const isAuth = sessionStorage.getItem('admin_token') || sessionStorage.getItem('basic_cred');
        
        if (isAuth) {
            this.showDashboard();
            
            // استخدام دالة التحديث لضمان ظهور الزر بشكل صحيح
            const role = sessionStorage.getItem('user_role');
            this.updateSettingsButtonVisibility(role); // <--- استخدام الدالة الجديدة
            this.updateutmbuilderButtonVisibility(role);
            this.updatemanagespendButtonVisibility(role);
            this.updaterecordspendButtonVisibility(role);
            this.fetchAllData();
        } else {
            this.showLogin();
        }
    }

    showLogin() {
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('dashboard-container').style.display = 'none';
    }

    showDashboard() {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('dashboard-container').style.display = 'flex';
    }

    async logout() {
        try {
            // 1. طلب تسجيل الخروج من السيرفر (لحذف الكوكيز إن وجدت)
            await fetch(`${this.API_URL}?action=logout`, { 
                method: 'POST',
                // لا نحتاج لانتظار الرد، المهم إرسال الطلب
            });
        } catch (e) {
            console.warn('Logout server request failed', e);
        } finally {
            // 2. تنظيف التخزين المحلي في كل الأحوال
            sessionStorage.removeItem('admin_token');
            sessionStorage.removeItem('user_role');
            sessionStorage.removeItem('auth_type');
            sessionStorage.removeItem('user_permissions');
            sessionStorage.removeItem('basic_cred');
            
            // 3. إعادة تحميل الصفحة لصفحة الدخول
            window.location.reload();
        }
    }

    bindEvents() {
        // 1. تسجيل الدخول (محدث للنظام الهجين)
        // داخل دالة bindEvents()
        document.getElementById('record-spend-btn')?.addEventListener('click', () => this.showRecordSpendModal());
        document.getElementById('utm-builder-btn')?.addEventListener('click', () => this.showUTMBuilderModal());
        document.getElementById('login-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const errorMsg = document.getElementById('login-error');
            
            btn.disabled = true;
            btn.textContent = 'جاري التحقق...';
            errorMsg.style.display = 'none';

            const u = document.getElementById('username').value;
            const p = document.getElementById('password').value;

            try {
                const response = await fetch(this.API_URL, { // تأكد أن الرابط يدعم /login
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p })
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    // تخزين التوكن والدور
                    sessionStorage.setItem('admin_token', result.token || ''); // قد يكون فارغاً في حالة الباب الخلفي
                    sessionStorage.setItem('user_role', result.role || 'editor');
                    sessionStorage.setItem('auth_type', result.type || 'unknown'); // backdoor or supabase
                    sessionStorage.setItem('user_permissions', JSON.stringify(result.permissions || { can_edit: false, can_view_stats: false }));
                    // في حالة الباب الخلفي، نستخدم Basic Auth كتخزين احتياطي
                    if (result.type === 'backdoor') {
                        sessionStorage.setItem('basic_cred', btoa(u + ':' + p));
                    }

                    window.location.reload();
                } else {
                    throw new Error(result.error || 'فشل الدخول');
                }
            } catch (err) {
                errorMsg.textContent = err.message;
                errorMsg.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'دخول';
            }
        });

        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        document.getElementById('refresh-btn')?.addEventListener('click', () => this.fetchAllData());

        // زر الإعدادات الجديد
        document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettingsModal());

        // باقي الفلاتر كما هي...
        ['search-input', 'status-filter', 'payment-filter', 'course-filter', 'date-filter', 'start-date', 'end-date'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(id.includes('input') ? 'input' : 'change', () => this.applyLocalFilters());
        });

        document.getElementById('date-filter')?.addEventListener('change', (e) => {
            const c = document.getElementById('custom-date-range');
            if (c) c.classList.toggle('hidden', e.target.value !== 'custom');
        });

        document.getElementById('prev-page')?.addEventListener('click', () => this.changePage(-1));
        document.getElementById('next-page')?.addEventListener('click', () => this.changePage(1));

        const addBtn = document.getElementById('add-btn');
        if (addBtn) addBtn.addEventListener('click', () => this.showAddModal());
        // 4. أزرار الميزات الجديدة (UTM & Spend)
        const utmBtn = document.getElementById('utm-builder-btn');
        if(utmBtn) utmBtn.addEventListener('click', () => this.showUTMBuilderModal());

        const recordBtn = document.getElementById('record-spend-btn');
        if(recordBtn) recordBtn.addEventListener('click', () => this.showRecordSpendModal());

        // ============================================================
        // 5. [إصلاح حاسم] زر عرض السجل (Manage Spend)
        // ============================================================
        const manageBtn = document.getElementById('manage-spend-btn');
        
        if (manageBtn) {
            // إزالة أي مستمع قديم (لتجنب التكرار)
            const newBtn = manageBtn.cloneNode(true);
            manageBtn.parentNode.replaceChild(newBtn, manageBtn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault(); // منع أي سلوك افتراضي
                console.log("تم ضغط زر عرض السجل!"); // رسالة للتأكد في الكونسول

                const section = document.getElementById('spend-management-section');
                if (section) {
                    section.classList.toggle('hidden');
                    
                    if (!section.classList.contains('hidden')) {
                        // 1. تحميل البيانات
                        this.renderSpendManagementTable();
                        // 2. [جديد] التمرير التلقائي للأسفل لرؤية الجدول
                        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // 3. تمييز القسم بوميض بسيط
                        section.classList.add('ring-4', 'ring-orange-200');
                        setTimeout(() => section.classList.remove('ring-4', 'ring-orange-200'), 1000);
                    }
                } else {
                    alert("خطأ: قسم الجدول (spend-management-section) غير موجود في HTML!");
                }
            });
        } else {
            console.warn("تنبيه: زر 'manage-spend-btn' غير موجود في الصفحة.");
        }
    }

   // ============================================================
    // دوال إدارة المصاريف (يجب أن تكون هنا داخل الكلاس)
    // ============================================================
    renderSpendManagementTable() {
        const tbody = document.getElementById('spend-table-body');
        if (!tbody) return;

        if (!this.spendData || this.spendData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-500">لا توجد مصاريف مسجلة.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.spendData.map((item, idx) => `
            <tr class="hover:bg-orange-50 transition-colors">
                <td class="px-4 py-3 font-mono text-gray-600">${item.date}</td>
                <td class="px-4 py-3 font-bold text-gray-800">${this.sanitizeHTML(item.campaign)}</td>
                <td class="px-4 py-3 text-sm text-gray-500">${this.sanitizeHTML(item.source)}</td>
                <td class="px-4 py-3 text-center text-gray-400 text-xs">${item.impressions ? item.impressions.toLocaleString() : '-'}</td>
                <td class="px-4 py-3 text-center text-gray-400 text-xs">${item.clicks ? item.clicks.toLocaleString() : '-'}</td>
                <td class="px-4 py-3 text-center font-bold text-orange-600 dir-ltr">${parseFloat(item.spend).toLocaleString()}</td>
                <td class="px-4 py-3 text-center">
                    <div class="flex justify-center gap-2">
                        <button onclick="dashboard.openEditSpendModal(${idx})" class="text-blue-500 hover:text-blue-700 p-1 bg-blue-50 rounded" title="تعديل">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onclick="dashboard.deleteSpendRecord(${idx})" class="text-red-500 hover:text-red-700 p-1 bg-red-50 rounded" title="حذف">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async deleteSpendRecord(idx) {
        if (!confirm('هل أنت متأكد من حذف هذا السجل المالي؟')) return;
        
        try {
            const res = await fetch(`${this.API_URL}?action=delete_spend`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                body: JSON.stringify({ rowIndex: idx })
            });
            
            if (res.ok) {
                alert('تم الحذف بنجاح');
                this.fetchAllData(); 
                document.getElementById('spend-management-section').classList.add('hidden');
            } else {
                alert('فشل الحذف');
            }
        } catch (e) { alert(e.message); }
    }

    openEditSpendModal(idx) {
        const item = this.spendData[idx];
        if (!item) return;

        const h = `
        <form id="edit-spend-form" class="space-y-4 text-right" dir="rtl">
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-700 mb-1">التاريخ</label>
                    <input type="date" name="date" required class="w-full p-2 border rounded" value="${item.date}">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-700 mb-1">الحملة</label>
                    <input type="text" name="campaign" required class="w-full p-2 border rounded bg-gray-100" value="${item.campaign}" readonly>
                </div>
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">المصدر</label>
                <input type="text" name="source" class="w-full p-2 border rounded" value="${item.source}">
            </div>
            <div class="grid grid-cols-3 gap-3 bg-orange-50 p-3 rounded">
                <div>
                    <label class="block text-[10px] font-bold text-gray-600">Spend</label>
                    <input type="number" step="0.01" name="spend" class="w-full p-2 border rounded font-bold" value="${item.spend}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-600">Impressions</label>
                    <input type="number" name="impressions" class="w-full p-2 border rounded" value="${item.impressions}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-600">Clicks</label>
                    <input type="number" name="clicks" class="w-full p-2 border rounded" value="${item.clicks}">
                </div>
            </div>
        </form>`;

        const act = `
            <button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 rounded">إلغاء</button>
            <button id="btn-update-spend" class="px-4 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">حفظ التعديلات</button>
        `;

        const m = this.createModal('تعديل مصروف', h, act);

        m.querySelector('#btn-update-spend').onclick = async () => {
            const btn = m.querySelector('#btn-update-spend');
            btn.textContent = '...'; btn.disabled = true;

            const form = m.querySelector('#edit-spend-form');
            const fd = new FormData(form);
            const payload = {
                rowIndex: idx,
                ...Object.fromEntries(fd.entries())
            };

            try {
                const res = await fetch(`${this.API_URL}?action=update_spend`, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    alert('تم التعديل بنجاح');
                    m.remove();
                    this.fetchAllData();
                    document.getElementById('spend-management-section').classList.add('hidden');
                } else {
                    alert('فشل التعديل');
                }
            } catch (e) { alert(e.message); }
        };
    } 

    // ============================================================
// 2. أضف هذه الدالة الجديدة بالكامل داخل الكلاس
// ============================================================
showUTMBuilderModal() {
    const h = `
    <div class="space-y-4 text-right" dir="rtl">
        <div class="bg-purple-50 p-3 rounded-lg border border-purple-100 text-sm text-purple-800 mb-4">
            استخدم هذه الأداة لإنشاء روابط تتبع دقيقة. البيانات المدخلة هنا ستظهر تلقائياً في لوحة التحليلات.
        </div>

        <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">رابط الصفحة الأساسي (Website URL)</label>
            <input id="utm-base-url" class="w-full p-2 border border-gray-300 rounded text-left dir-ltr focus:ring-2 focus:ring-purple-500" placeholder="https://tadrib.ma/registration" value="https://tadrib.ma">
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">المصدر (Source) <span class="text-red-500">*</span></label>
                <input id="utm-source" class="w-full p-2 border border-gray-300 rounded text-sm placeholder-gray-400" placeholder="facebook, google, tiktok">
                <p class="text-[10px] text-gray-500 mt-1">المنصة: أين سينشر الرابط؟</p>
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">الوسيط (Medium) <span class="text-red-500">*</span></label>
                <select id="utm-medium" class="w-full p-2 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-purple-500">
    <optgroup label="إعلانات مدفوعة (Paid Ads)">
        <option value="cpc">CPC (دفع للنقرة - Performance)</option>
        <option value="cpm">CPM (دفع للظهور - Awareness)</option>
        <option value="display">Display (بانر/صورة)</option>
        <option value="paid_social">Paid Social (إعلان ممول عام)</option>
    </optgroup>

    <optgroup label="نشر عضوي (Organic Social)">
        <option value="organic">Organic (بحث/وصول طبيعي)</option>
        <option value="post">Post (منشور عادي)</option>
        <option value="story">Story (قصة/ستوري)</option>
        <option value="reel">Reel/TikTok (فيديو قصير)</option>
        <option value="profile">Profile/Bio (رابط البايو)</option>
        <option value="video">Video (يوتيوب/فيديو طويل)</option>
    </optgroup>

    <optgroup label="مراسلات (Messaging)">
        <option value="whatsapp">WhatsApp (رسالة/حالة)</option>
        <option value="email">Email (نشرة بريدية)</option>
        <option value="sms">SMS (رسالة نصية)</option>
        <option value="push">Push Notification (إشعار)</option>
    </optgroup>

    <optgroup label="شراكات وأخرى (Partnerships & Other)">
        <option value="referral">Referral (إحالة من موقع آخر)</option>
        <option value="affiliate">Affiliate (تسويق بالعمولة)</option>
        <option value="influencer">Influencer (مؤثرين)</option>
        <option value="qr">QR Code (مطبوعات/أوفلاين)</option>
        <option value="event">Event (حدث/فعالية)</option>
    </optgroup>
</select><select id="utm-medium" class="w-full p-2 border border-gray-300 rounded text-sm bg-white">
                    <option value="cpc">CPC (إعلان مدفوع)</option>
                    <option value="organic">Organic (نشر مجاني)</option>
                    <option value="social">Social (مشاركة اجتماعية)</option>
                    <option value="email">Email (بريد إلكتروني)</option>
                    <option value="referral">Referral (إحالة)</option>
                    <option value="whatsapp">WhatsApp</option>
                </select>
                <p class="text-[10px] text-gray-500 mt-1">نوع التكلفة أو آلية النشر.</p>
            </div>
        </div>

        <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">اسم الحملة (Campaign Name) <span class="text-red-500">*</span></label>
            <input id="utm-campaign" class="w-full p-2 border border-gray-300 rounded text-sm" placeholder="summer_offer, pmp_launch">
            <p class="text-[10px] text-gray-500 mt-1">اسم المشروع أو العرض الترويجي.</p>
        </div>

        <div class="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded border border-gray-200">
            <div>
                <label class="block text-xs font-bold text-gray-600 mb-1">المحتوى (Content) - اختياري</label>
                <input id="utm-content" class="w-full p-2 border border-gray-300 rounded text-sm" placeholder="video_ad_1, banner_blue">
                <p class="text-[10px] text-gray-400 mt-1">لتمييز الإعلانات المختلفة (Creative).</p>
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-600 mb-1">الكلمة/الجمهور (Term) - اختياري</label>
                <input id="utm-term" class="w-full p-2 border border-gray-300 rounded text-sm" placeholder="managers, lookalike">
                <p class="text-[10px] text-gray-400 mt-1">الجمهور المستهدف أو الكلمة المفتاحية.</p>
            </div>
        </div>

        <div class="mt-4 pt-4 border-t border-gray-200">
            <label class="block text-xs font-bold text-purple-700 mb-2">الرابط النهائي (Generated URL)</label>
            <div class="flex gap-2">
                <input id="utm-result" readonly class="w-full p-3 bg-gray-100 border border-gray-300 rounded text-xs font-mono text-gray-600 break-all" dir="ltr" value="...">
                <button id="btn-copy-url" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 rounded flex items-center justify-center" title="نسخ الرابط">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                </button>
            </div>
        </div>
    </div>`;

    const act = `
        <button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition">إغلاق</button>
    `;

    this.createModal('منشئ روابط التتبع (UTM Builder)', h, act);

    // --- المنطق التفاعلي (Live Generation) ---
    const inputs = ['utm-base-url', 'utm-source', 'utm-medium', 'utm-campaign', 'utm-content', 'utm-term'];
    const resultInput = document.getElementById('utm-result');

    const generateURL = () => {
        const baseUrl = document.getElementById('utm-base-url').value.trim();
        const source = document.getElementById('utm-source').value.trim();
        const medium = document.getElementById('utm-medium').value.trim();
        const campaign = document.getElementById('utm-campaign').value.trim();
        const content = document.getElementById('utm-content').value.trim();
        const term = document.getElementById('utm-term').value.trim();

        if (!baseUrl || !source || !medium || !campaign) {
            resultInput.value = 'الرجاء ملء الحقول الإجبارية (*) لتوليد الرابط';
            return;
        }

        try {
            const url = new URL(baseUrl);
            // إضافة المعاملات (يتم ترميزها تلقائياً بواسطة URLSearchParams)
            url.searchParams.set('utm_source', source);
            url.searchParams.set('utm_medium', medium);
            url.searchParams.set('utm_campaign', campaign);
            if (content) url.searchParams.set('utm_content', content);
            if (term) url.searchParams.set('utm_term', term);

            resultInput.value = url.toString();
        } catch (e) {
            resultInput.value = 'رابط أساسي غير صالح';
        }
    };

    // ربط الأحداث للتحديث الفوري
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', generateURL);
    });

    // زر النسخ
    document.getElementById('btn-copy-url').onclick = () => {
        if (resultInput.value && !resultInput.value.startsWith('الرجاء')) {
            navigator.clipboard.writeText(resultInput.value);
            const originalIcon = document.getElementById('btn-copy-url').innerHTML;
            document.getElementById('btn-copy-url').innerHTML = '<span class="text-green-600 font-bold text-xs">تم!</span>';
            setTimeout(() => document.getElementById('btn-copy-url').innerHTML = originalIcon, 2000);
        }
    };
}

// ============================================================
// (New) Show Record Spend Modal
// ============================================================
showRecordSpendModal() {
    // 1. استخراج قائمة الحملات الفريدة من البيانات الحالية لتسهيل الاختيار
    const existingCampaigns = [...new Set(this.allData.map(i => i.utm_campaign))].filter(c => c && c !== 'undefined' && c !== 'Organic/Direct').sort();
    
    // إنشاء خيارات القائمة
    const campaignOptions = existingCampaigns.map(c => `<option value="${c}">${c}</option>`).join('');

    const h = `
    <form id="spend-form" class="space-y-4 text-right" dir="rtl">
        <div class="bg-orange-50 p-3 rounded-lg border border-orange-100 flex gap-2 items-start">
            <svg class="w-5 h-5 text-orange-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
            <p class="text-xs text-orange-800">
                تسجيل المصاريف اليومية يتيح للنظام حساب العائد على الاستثمار (ROAS) وتكلفة الاستحواذ (CPA).
            </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">التاريخ <span class="text-red-500">*</span></label>
                <input type="date" name="date" required class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500" value="${new Date().toISOString().split('T')[0]}">
            </div>

            <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">الحملة (Campaign) <span class="text-red-500">*</span></label>
                <div class="relative">
                    <input list="campaigns-list" name="campaign" required class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500" placeholder="اكتب أو اختر...">
                    <datalist id="campaigns-list">
                        ${campaignOptions}
                    </datalist>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-3 bg-gray-50 p-3 rounded border">
            <div>
                <label class="block text-[10px] font-bold text-gray-600 mb-1">المبلغ المصروف (Spend) <span class="text-red-500">*</span></label>
                <input type="number" step="0.01" name="spend" required class="w-full p-2 border border-gray-300 rounded text-sm font-bold text-gray-800" placeholder="0.00">
            </div>
            <div>
                <label class="block text-[10px] font-bold text-gray-600 mb-1">الظهور (Impressions)</label>
                <input type="number" name="impressions" class="w-full p-2 border border-gray-300 rounded text-sm" placeholder="0">
            </div>
            <div>
                <label class="block text-[10px] font-bold text-gray-600 mb-1">النقرات (Clicks)</label>
                <input type="number" name="clicks" class="w-full p-2 border border-gray-300 rounded text-sm" placeholder="0">
            </div>
        </div>

        <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">المصدر (Source) - اختياري</label>
            <select name="source" class="w-full p-2 border border-gray-300 rounded text-sm bg-white">
                <option value="All">عام / متعدد المصادر</option>
                <option value="facebook">Facebook / Instagram</option>
                <option value="google">Google Ads</option>
                <option value="tiktok">TikTok</option>
                <option value="snapchat">Snapchat</option>
                <option value="linkedin">LinkedIn</option>
            </select>
        </div>
    </form>`;

    const act = `
        <button onclick="document.getElementById('modal-container').innerHTML=''" class="px-4 py-2 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition">إلغاء</button>
        <button id="btn-save-spend" class="px-4 py-2 bg-orange-600 text-white rounded font-bold hover:bg-orange-700 transition shadow flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            حفظ البيانات
        </button>
    `;

    const m = this.createModal('تسجيل مصاريف إعلانية', h, act);

    // منطق الحفظ
    m.querySelector('#btn-save-spend').onclick = async () => {
        const form = m.querySelector('#spend-form');
        if (!form.checkValidity()) {
            alert('يرجى ملء الحقول الإجبارية (التاريخ، الحملة، المبلغ)');
            return;
        }

        const btn = m.querySelector('#btn-save-spend');
        btn.textContent = 'جاري الحفظ...'; btn.disabled = true;

        const fd = new FormData(form);
        const payload = Object.fromEntries(fd.entries());

        try {
            const res = await fetch(`${this.API_URL}?action=add_spend`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, this.getAuthHeaders()),
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                alert('تم تسجيل المصروف بنجاح ✅');
                m.remove();
                // سنقوم بإعادة تحميل البيانات لكي تظهر التحديثات فوراً في الحسابات
                this.fetchAllData(); 
            } else {
                const err = await res.json();
                alert('فشل الحفظ: ' + (err.error || 'خطأ غير معروف'));
                btn.textContent = 'حفظ البيانات'; btn.disabled = false;
            }
        } catch (e) {
            alert('خطأ في الاتصال: ' + e.message);
            btn.textContent = 'حفظ البيانات'; btn.disabled = false;
        }
    };
}
}

// تشغيل النظام عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new AdminDashboard();
});
