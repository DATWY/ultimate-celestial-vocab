// src/features/fsrsPersona.js — FSRS-7 Cognitive Persona & Mind Profiler
import { getState } from '../core/state.js';
import { DEFAULT_FSRS7_PARAMS } from '../core/srs/constants.js';

/**
 * Phân tích chuyên sâu 34 tham số của FSRS-7 để vẽ nên Chân Dung Nhận Thức học tập.
 * Thuật toán so sánh từng miền trọng số với bộ chuẩn Lab (DEFAULT_FSRS7_PARAMS)
 * để tính toán ra 5 Trụ Cột Nhận Thức, Danh Hiệu Chủ Đạo và Chiến Lược Học Tập Cá Nhân Hóa.
 */
export function analyzeFsrs7Persona(userParams, trainedAtTimestamp) {
    const p = (Array.isArray(userParams) && userParams.length === 34) ? userParams : DEFAULT_FSRS7_PARAMS;
    const isPersonalized = (Array.isArray(userParams) && userParams.length === 34 && JSON.stringify(userParams) !== JSON.stringify(DEFAULT_FSRS7_PARAMS));
    const base = DEFAULT_FSRS7_PARAMS;

    // Helper: tính tỷ lệ phần trăm sai khác so với chuẩn Lab
    const getDeltaPct = (val, baseVal) => {
        if (!baseVal) return 0;
        return ((val - baseVal) / baseVal) * 100;
    };

    // 1. TRỤ CỘT 1: KHẢ NĂNG HẤP THỤ BAN ĐẦU (Initial Concept Absorption)
    // Dựa trên w[0..3]: S0 của Again, Hard, Good, Easy
    // w[2] (Good S0): chuẩn Lab là 3.9221 ngày
    const s0Good = p[2];
    const s0GoodDelta = getDeltaPct(s0Good, base[2]);
    // w[3] / w[2]: Tỷ lệ phân hóa thẻ dễ
    const easyRatio = p[3] / (p[2] || 1);
    const easyRatioBase = base[3] / base[2]; // ~3.0
    // Điểm chuẩn hóa 0 - 100
    let absorptionScore = Math.min(99, Math.max(30, Math.round(50 + (s0GoodDelta * 1.2) + ((easyRatio - easyRatioBase) * 8))));

    let absorptionTitle = "Khắc Sâu Tự Nhiên";
    let absorptionDesc = "Khả năng tiếp thu khái niệm mới ở mức tự nhiên, nhịp nhàng và ổn định.";
    if (absorptionScore >= 75) {
        absorptionTitle = "Hấp Thụ Nhanh (Fast Acquisition)";
        absorptionDesc = "Não bộ liên kết từ mới vào mạng lưới tri thức rất nhạy bén; ấn tượng đầu lưu giữ lâu.";
    } else if (absorptionScore <= 45) {
        absorptionTitle = "Học Kỹ & Cẩn Trọng (Deliberate Learner)";
        absorptionDesc = "Cần chu kỳ lặp lại gần hơn ở giai đoạn đầu để chuyển hóa kiến thức từ ngắn hạn sang dài hạn.";
    }

    // 2. TRỤ CỘT 2: TÍCH LŨY DÀI HẠN (Long-Term Compounding Power)
    // Dựa trên w[7] (sinc_base: chuẩn Lab 1.9795) và w[14] (easy_bonus: chuẩn 1.0)
    const sinc = p[7];
    const sincDelta = getDeltaPct(sinc, base[7]);
    const easyBonus = p[14];
    let compoundingScore = Math.min(99, Math.max(25, Math.round(50 + (sincDelta * 1.5) + ((easyBonus - base[14]) * 20))));

    let compoundingTitle = "Tăng Trưởng Nhịp Nhàng";
    let compoundingDesc = "Khoảng cách ôn tập giãn ra đều đặn theo cấp số nhân chuẩn khoa học.";
    if (compoundingScore >= 75) {
        compoundingTitle = "Tích Lũy Bùng Nổ (Exponential Compounding)";
        compoundingDesc = "Khi đã thuộc liên tiếp, chu kỳ nhớ giãn ra cực mạnh; kiến thức nhanh chóng ăn sâu vào tiềm thức.";
    } else if (compoundingScore <= 45) {
        compoundingTitle = "Củng Cố Liên Tục (Steady Frequency)";
        compoundingDesc = "Khoảng cách ôn tập giãn vừa phải, thích hợp với người học thích gặp lại từ vựng thường xuyên để yên tâm.";
    }

    // 3. TRỤ CỘT 3: SỨC BẬT PHỤC HỒI KHI QUÊN (Cognitive Resilience / Amnesia Bounce)
    // Dựa trên w[10] (fail_base: chuẩn Lab 0.7024) và w[11] (fail_power: chuẩn 0.5999)
    const failBase = p[10];
    const failDelta = getDeltaPct(failBase, base[10]);
    let resilienceScore = Math.min(99, Math.max(20, Math.round(50 + (failDelta * 2.0))));

    let resilienceTitle = "Phục Hồi Thích Nghi";
    let resilienceDesc = "Khi quên, bạn lấy lại phong độ ở mức tiêu chuẩn sau một vài lần nhắc lại.";
    if (resilienceScore >= 75) {
        resilienceTitle = "Sức Bật Phượng Hoàng (Resilient Bounce)";
        resilienceDesc = "Khi bấm 'Quên', dấu vết ký ức ngầm vẫn được bảo tồn đến hơn 80%; bạn hồi sinh trí nhớ cực nhanh.";
    } else if (resilienceScore <= 45) {
        resilienceTitle = "Xây Lại Từ Gốc (Clean-Slate Rebuilder)";
        resilienceDesc = "Mỗi khi quên, não bộ có xu hướng muốn rà soát và xây dựng lại từ nền móng, không để sót lỗ hổng.";
    }

    // 4. TRỤ CỘT 4: TIÊU CHUẨN & ĐỘ KHẮT KHE (Perceived Friction & Standards)
    // Dựa trên w[4] (init_d_base: chuẩn Lab 6.1686) và w[6] (delta_d_scale: chuẩn 3.6807)
    const diffBase = p[4];
    const diffDelta = getDeltaPct(diffBase, base[4]);
    const deltaScale = p[6];
    const deltaScaleDelta = getDeltaPct(deltaScale, base[6]);
    let frictionScore = Math.min(99, Math.max(20, Math.round(50 + (diffDelta * 1.3) + (deltaScaleDelta * 0.7))));

    let frictionTitle = "Thực Tế & Cân Bằng";
    let frictionDesc = "Đánh giá khách quan độ phức tạp của bài học, không quá áp lực cũng không chủ quan.";
    if (frictionScore >= 75) {
        frictionTitle = "Khắt Khe & Cầu Toàn (High-Bar Perfectionist)";
        frictionDesc = "Đòi hỏi độ chính xác tuyệt đối; đánh giá từ mới có độ khó cao và phân loại nghiêm khắc.";
    } else if (frictionScore <= 45) {
        frictionTitle = "Tự Tin & Phóng Khoáng (Low-Friction Flow)";
        frictionDesc = "Tâm lý học tập thoải mái, dễ dàng đón nhận từ mới mà không bị rào cản sợ khó khăn.";
    }

    // 5. TRỤ CỘT 5: ĐỘ BỀN BỈ KHÁNG QUÊN (Forgetting Resistance & Vault Depth)
    // Dựa trên nghịch đảo của w[23] (fast decay: chuẩn 0.1567) và w[24] (slow decay: chuẩn 0.0801)
    const decay1 = p[23];
    const decay2 = p[24];
    const decay1Delta = getDeltaPct(decay1, base[23]);
    const decay2Delta = getDeltaPct(decay2, base[24]);
    // Decay càng thấp thì kháng quên càng cao
    let resistanceScore = Math.min(99, Math.max(20, Math.round(50 - (decay1Delta * 0.8) - (decay2Delta * 1.2))));

    let resistanceTitle = "Độ Bền Ký Ức Chuẩn";
    let resistanceDesc = "Tốc độ suy giảm ký ức tuân theo đường cong lãng quên tự nhiên của tâm lý học thực nghiệm.";
    if (resistanceScore >= 75) {
        resistanceTitle = "Két Sắt Ký Ức (Vault-Lock Memory)";
        resistanceDesc = "Tốc độ phân rã trí nhớ chậm hơn mức trung bình; một khi đã vượt qua vòng lọc là nhớ rất bền.";
    } else if (resistanceScore <= 45) {
        resistanceTitle = "Nhạy Cảm Với Thời Gian (Dynamic Decay)";
        resistanceDesc = "Kiến thức hao mòn nhanh hơn nếu không được ôn đúng hẹn; cần duy trì streak đều đặn.";
    }

    // 6. XÁC ĐỊNH DANH HIỆU NHẬN THỨC CHỦ ĐẠO (Primary Archetype)
    const pillars = [
        { id: 'resilience', name: 'Sức Bật Phục Hồi', score: resilienceScore },
        { id: 'compounding', name: 'Tích Lũy Dài Hạn', score: compoundingScore },
        { id: 'absorption', name: 'Hấp Thụ Ban Đầu', score: absorptionScore },
        { id: 'friction', name: 'Tiêu Chuẩn & Cầu Toàn', score: frictionScore },
        { id: 'resistance', name: 'Bền Bỉ Kháng Quên', score: resistanceScore }
    ];
    pillars.sort((a, b) => b.score - a.score);
    const topPillar = pillars[0];

    let archetype = {
        title: "Nhà Khám Phá Thích Ứng",
        enTitle: "The Adaptive Explorer",
        icon: "ph-duotone ph-compass",
        gradient: "linear-gradient(135deg, #06b6d4, #3b82f6, #8b5cf6)",
        badgeColor: "#06b6d4",
        motto: "Linh hoạt biến hóa theo từng dạng từ vựng, tự cân bằng nhịp thở nhận thức hoàn hảo.",
        summary: "Bộ não của bạn có sự hài hòa tuyệt vời giữa các chu kỳ tiếp nhận và duy trì. Bạn không bị đóng khung vào một khuôn mẫu cố định mà có thể điều chỉnh tốc độ học theo độ khó của từng chủ đề."
    };

    if (topPillar.id === 'resilience' && topPillar.score >= 68) {
        archetype = {
            title: "Học Giả Phượng Hoàng",
            enTitle: "The Resilient Phoenix",
            icon: "ph-duotone ph-fire",
            gradient: "linear-gradient(135deg, #f97316, #ef4444, #ec4899)",
            badgeColor: "#f97316",
            motto: "Vấp ngã không phải là xóa bỏ, mà là bệ phóng để mạng nơ-ron hồi sinh sắc bén hơn.",
            summary: "Đặc điểm nổi bật nhất của bạn là sức bật phi thường sau khi quên. Trọng số FSRS-7 chỉ ra rằng khi bạn bấm 'Again', hơn 80% dấu vết ký ức nền vẫn được bảo tồn nguyên vẹn, giúp bạn khôi phục độ bền dài hạn với tốc độ đáng kinh ngạc."
        };
    } else if (topPillar.id === 'compounding' && topPillar.score >= 68) {
        archetype = {
            title: "Kiến Trúc Sư Ký Ức",
            enTitle: "The Memory Architect",
            icon: "ph-duotone ph-buildings",
            gradient: "linear-gradient(135deg, #3b82f6, #6366f1, #8b5cf6)",
            badgeColor: "#6366f1",
            motto: "Xây dựng từng tầng tri thức vững như thành lũy, tích lũy theo cấp số nhân phi mã.",
            summary: "Bộ số cá nhân hóa của bạn cho thấy hệ số giãn cách dài hạn (sinc_base) vượt trội. Mỗi lần bạn thuộc một từ liên tiếp, khoảng cách ngày ôn sẽ nở rộng theo cấp số nhân mạnh mẽ, giúp bạn học được lượng từ khổng lồ mà không sợ bị quá tải ôn tập."
        };
    } else if (topPillar.id === 'friction' && topPillar.score >= 68) {
        archetype = {
            title: "Học Giả Cầu Toàn",
            enTitle: "The Precision Perfectionist",
            icon: "ph-duotone ph-crosshair",
            gradient: "linear-gradient(135deg, #a855f7, #9333ea, #7e22ce)",
            badgeColor: "#a855f7",
            motto: "Không thỏa hiệp với sự mơ hồ; nắm bắt tinh tường từng sắc thái nghĩa trước khi vượt qua.",
            summary: "Bạn có ngưỡng đánh giá độ khó ban đầu và độ nhạy cảm ứng rất cao. Bạn không bao giờ bấm 'Easy' một cách vội vã. Nhờ sự khắt khe này, một khi từ vựng đã được bạn công nhận là 'Đã thuộc', chất lượng ghi nhớ của bạn đạt độ chính xác gần như tuyệt đối."
        };
    } else if (topPillar.id === 'absorption' && topPillar.score >= 68) {
        archetype = {
            title: "Bậc Thầy Trực Giác",
            enTitle: "The Intuitive Synthesizer",
            icon: "ph-duotone ph-lightning",
            gradient: "linear-gradient(135deg, #eab308, #f59e0b, #f97316)",
            badgeColor: "#f59e0b",
            motto: "Bắt sóng tri thức bằng trực giác sắc bén, chuyển hóa khái niệm mới thành bản năng tức thì.",
            summary: "Độ bền ngày đầu (Initial Stability) của bạn cao hơn đáng kể so với mức trung bình. Bạn có khả năng liên kết từ vựng mới vào ngữ cảnh thực tế cực kỳ nhanh, giúp giảm bớt số lần phải lặp lại ở giai đoạn đầu."
        };
    } else if (topPillar.id === 'resistance' && topPillar.score >= 68) {
        archetype = {
            title: "Két Sắt Ký Ức",
            enTitle: "The Vault-Lock Master",
            icon: "ph-duotone ph-shield-check",
            gradient: "linear-gradient(135deg, #10b981, #059669, #047857)",
            badgeColor: "#10b981",
            motto: "Ký ức khóa chặt trong tiềm thức sâu thẳm, miễn nhiễm trước sự hao mòn của thời gian.",
            summary: "Đường cong lãng quên của bạn có hệ số phân rã cực kỳ thấp. Bạn có khả năng duy trì kiến thức trong thời gian dài mà ít bị rơi rụng, tạo nên nền tảng vững như kim cương cho việc học mở rộng."
        };
    }

    // 7. CHIẾN LƯỢC HỌC TẬP THỰC CHIẾN (Actionable Tailored Strategies)
    const recommendations = [];

    if (topPillar.id === 'resilience') {
        recommendations.push({
            icon: "ph-bold ph-shield-check",
            title: "Tận Dụng Sức Bật Sau Khi Quên",
            desc: `Đừng ngần ngại bấm 'Quên' (Again) khi vấp phải từ lạ. Não bạn phục hồi sau khi quên đạt đến ${(failBase * 100).toFixed(1)}% sức bền cũ, nên chỉ cần 1 lần ôn lại là bạn đã lấy lại vị thế đỉnh cao.`
        });
    } else if (topPillar.id === 'friction') {
        recommendations.push({
            icon: "ph-bold ph-scales",
            title: "Tự Tin Bấm 'Nhớ' & 'Dễ' Hơn",
            desc: `Bạn có xu hướng nghiêm khắc quá mức với bản thân (độ khó cơ sở ${diffBase.toFixed(2)}/10). Hãy mạnh dạn chấm 'Nhớ' hoặc 'Dễ' cho những từ đã nắm vững để thuật toán FSRS-7 giãn lịch thông thoáng hơn.`
        });
    } else {
        recommendations.push({
            icon: "ph-bold ph-trend-up",
            title: "Tối Ưu Hóa Nhịp Ôn Dài Hạn",
            desc: `Hệ số tăng trưởng của bạn đạt ${sinc.toFixed(2)}x. Hãy duy trì mục tiêu Retrievability ở mức 90% để lịch học mở rộng tối đa mà vẫn giữ được độ thuộc bài hoàn hảo.`
        });
    }

    if (p[23] > base[23]) {
        recommendations.push({
            icon: "ph-bold ph-hourglass-high",
            title: "Tập Trung Trong 24 Giờ Đầu",
            desc: "Dấu vết ký ức ngắn hạn phân rã nhanh ở ngày đầu tiên. Hãy ưu tiên ôn lại thẻ mới trong vòng 1 ngày để khóa chặt vào bộ đệm dài hạn trước khi phân rã."
        });
    } else {
        recommendations.push({
            icon: "ph-bold ph-brain",
            title: "Học Đào Sâu Ngữ Cảnh",
            desc: `Khả năng lưu giữ tự nhiên của bạn rất tốt (S0 đạt ${s0Good.toFixed(1)} ngày). Hãy dành thêm thời gian đọc kỹ ví dụ ngữ cảnh để khắc sâu nghĩa bóng và phản xạ tự nhiên.`
        });
    }

    recommendations.push({
        icon: "ph-bold ph-calendar-check",
        title: "Duy Trì Nhịp Điệu Đều Đặn",
        desc: "Thuật toán FSRS-7 phát huy sức mạnh tối đa khi bạn giải quyết hết thẻ đến hạn mỗi ngày. Việc giữ streak liên tục quan trọng hơn học dồn một lần vào cuối tuần."
    });

    return {
        isPersonalized,
        trainedAt: trainedAtTimestamp,
        archetype,
        pillars: [
            {
                id: 'resilience',
                name: 'Sức Bật Phục Hồi',
                score: resilienceScore,
                delta: failDelta,
                metric: `${(failBase * 100).toFixed(1)}%`,
                metricLabel: 'Bảo tồn sau quên',
                title: resilienceTitle,
                desc: resilienceDesc,
                color: '#ef4444'
            },
            {
                id: 'compounding',
                name: 'Tích Lũy Dài Hạn',
                score: compoundingScore,
                delta: sincDelta,
                metric: `${sinc.toFixed(2)}x`,
                metricLabel: 'Hệ số giãn cách',
                title: compoundingTitle,
                desc: compoundingDesc,
                color: '#6366f1'
            },
            {
                id: 'absorption',
                name: 'Hấp Thụ Ban Đầu',
                score: absorptionScore,
                delta: s0GoodDelta,
                metric: `${s0Good.toFixed(2)} ngày`,
                metricLabel: 'Chu kỳ S0 (Good)',
                title: absorptionTitle,
                desc: absorptionDesc,
                color: '#f59e0b'
            },
            {
                id: 'friction',
                name: 'Độ Khắt Khe & Tiêu Chuẩn',
                score: frictionScore,
                delta: diffDelta,
                metric: `${diffBase.toFixed(2)}/10`,
                metricLabel: 'Độ khó cơ sở (D0)',
                title: frictionTitle,
                desc: frictionDesc,
                color: '#a855f7'
            },
            {
                id: 'resistance',
                name: 'Kháng Quên Dài Hạn',
                score: resistanceScore,
                delta: -decay1Delta,
                metric: `${(decay2 * 100).toFixed(2)}%`,
                metricLabel: 'Tốc độ suy hao chậm',
                title: resistanceTitle,
                desc: resistanceDesc,
                color: '#10b981'
            }
        ],
        comparisonMetrics: {
            s0Good: { val: s0Good, base: base[2], delta: s0GoodDelta },
            sinc: { val: sinc, base: base[7], delta: sincDelta },
            failBase: { val: failBase, base: base[10], delta: failDelta },
            diffBase: { val: diffBase, base: base[4], delta: diffDelta }
        },
        recommendations
    };
}

/**
 * Render toàn bộ giao diện Tab "Chân Dung Nhận Thức" vào container DOM.
 */
export function renderFsrsPersonaUI(container) {
    if (!container) return;

    const state = getState();
    const userParams = state.userFsrs7Params;
    const trainedAt = state.userFsrs7TrainedAt;

    const data = analyzeFsrs7Persona(userParams, trainedAt);

    // Format ngày cập nhật
    let statusBadgeHtml = '';
    if (data.isPersonalized) {
        const trainedDateStr = data.trainedAt ? new Date(data.trainedAt).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Gần đây';
        statusBadgeHtml = `
            <div class="persona-status-badge personalized">
                <span class="pulse-dot"></span>
                <i class="ph-fill ph-sparkle"></i>
                <span>Bộ Số Độc Bản FSRS-7 (Đã cá nhân hóa: <strong>${trainedDateStr}</strong>)</span>
            </div>
        `;
    } else {
        statusBadgeHtml = `
            <div class="persona-status-badge baseline">
                <i class="ph-bold ph-flask"></i>
                <span>Đang Phân Tích Trên Bộ Chuẩn Lab (Chạy tool huấn luyện FSRS-7 cá nhân để mở khóa 100% vân tay não bộ)</span>
            </div>
        `;
    }

    const html = `
        <div class="persona-container">
            <!-- Header Badge Trạng Thái -->
            <div class="persona-meta-header">
                ${statusBadgeHtml}
            </div>

            <!-- HERO CARD: DANH HIỆU NHẬN THỨC CHỦ ĐẠO -->
            <section class="profile-card persona-hero-card" style="--hero-glow: ${data.archetype.badgeColor}">
                <div class="persona-hero-bg-glow" style="background: ${data.archetype.gradient}"></div>
                <div class="persona-hero-inner">
                    <div class="persona-avatar-wrapper">
                        <div class="persona-avatar-glow" style="background: ${data.archetype.gradient}">
                            <i class="${data.archetype.icon}"></i>
                        </div>
                    </div>
                    <div class="persona-hero-content">
                        <div class="persona-tag-row">
                            <span class="persona-tag" style="border-color: ${data.archetype.badgeColor}; color: ${data.archetype.badgeColor}">
                                BẢN SẮC TRÍ TUỆ
                            </span>
                            <span class="persona-en-title">${data.archetype.enTitle}</span>
                        </div>
                        <h2 class="persona-hero-title">${data.archetype.title}</h2>
                        <blockquote class="persona-motto">“${data.archetype.motto}”</blockquote>
                        <p class="persona-summary">${data.archetype.summary}</p>
                    </div>
                </div>
            </section>

            <!-- 5 TRỤ CỘT NHẬN THỨC (COGNITIVE PILLARS) -->
            <section class="profile-card persona-pillars-card">
                <div class="persona-section-header">
                    <div class="section-title-group">
                        <h3><i class="ph-bold ph-dna"></i> 5 Trụ Cột Nhận Thức Toán Học</h3>
                        <span class="section-subtitle">Phân tích từ 34 tham số trọng số Dual-Stability FSRS-7</span>
                    </div>
                </div>

                <div class="persona-pillars-grid">
                    ${data.pillars.map(pillar => {
                        const deltaSign = pillar.delta >= 0 ? '+' : '';
                        const deltaClass = pillar.delta >= 0 ? 'positive' : 'negative';
                        return `
                            <div class="pillar-item" style="--pillar-color: ${pillar.color}">
                                <div class="pillar-header">
                                    <span class="pillar-name">${pillar.name}</span>
                                    <span class="pillar-score-badge">${pillar.score}/100</span>
                                </div>
                                <div class="pillar-meter-track">
                                    <div class="pillar-meter-fill" style="width: ${pillar.score}%; background: ${pillar.color}"></div>
                                </div>
                                <div class="pillar-details">
                                    <div class="pillar-metric-row">
                                        <span class="pillar-metric-val">${pillar.metric}</span>
                                        <span class="pillar-delta ${deltaClass}">${deltaSign}${pillar.delta.toFixed(1)}% so với Lab</span>
                                    </div>
                                    <div class="pillar-verdict">${pillar.title}</div>
                                    <p class="pillar-desc">${pillar.desc}</p>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </section>

            <!-- BENTO 2 CỘT: SO SÁNH THÔNG SỐ & CHIẾN LƯỢC HỌC TẬP -->
            <div class="persona-bento-grid">
                <!-- Cột Trái: Thông số cốt lõi -->
                <section class="profile-card persona-stats-card">
                    <h3><i class="ph-duotone ph-chart-polar"></i> Vân Tay Tham Số Trí Nhớ</h3>
                    <div class="stats-comparison-list">
                        <div class="stats-comp-row">
                            <div class="comp-label">
                                <strong>Chu kỳ ấn tượng đầu (S0 Good)</strong>
                                <span>Thời gian nhớ tự nhiên lần đầu học</span>
                            </div>
                            <div class="comp-values">
                                <span class="val-current">${data.comparisonMetrics.s0Good.val.toFixed(2)} ngày</span>
                                <span class="val-base">Lab: ${data.comparisonMetrics.s0Good.base.toFixed(2)}d</span>
                            </div>
                        </div>

                        <div class="stats-comp-row">
                            <div class="comp-label">
                                <strong>Hệ số giãn cách dài hạn (sinc)</strong>
                                <span>Tốc độ nhân khoảng cách ôn tập</span>
                            </div>
                            <div class="comp-values">
                                <span class="val-current">${data.comparisonMetrics.sinc.val.toFixed(2)}x</span>
                                <span class="val-base">Lab: ${data.comparisonMetrics.sinc.base.toFixed(2)}x</span>
                            </div>
                        </div>

                        <div class="stats-comp-row">
                            <div class="comp-label">
                                <strong>Bảo tồn ký ức sau khi quên</strong>
                                <span>Phần trăm dấu vết ngầm còn giữ lại</span>
                            </div>
                            <div class="comp-values">
                                <span class="val-current">${(data.comparisonMetrics.failBase.val * 100).toFixed(1)}%</span>
                                <span class="val-base">Lab: ${(data.comparisonMetrics.failBase.base * 100).toFixed(1)}%</span>
                            </div>
                        </div>

                        <div class="stats-comp-row">
                            <div class="comp-label">
                                <strong>Độ khó cảm nhận cơ sở (D0)</strong>
                                <span>Mức độ khắt khe khi gặp từ mới</span>
                            </div>
                            <div class="comp-values">
                                <span class="val-current">${data.comparisonMetrics.diffBase.val.toFixed(2)} / 10</span>
                                <span class="val-base">Lab: ${data.comparisonMetrics.diffBase.base.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Cột Phải: Lời khuyên thực chiến -->
                <section class="profile-card persona-advice-card">
                    <h3><i class="ph-duotone ph-lightbulb"></i> Chiến Lược Học Tập Tùy Chỉnh</h3>
                    <div class="persona-advice-list">
                        ${data.recommendations.map(rec => `
                            <div class="advice-item">
                                <div class="advice-icon"><i class="${rec.icon}"></i></div>
                                <div class="advice-text">
                                    <h4>${rec.title}</h4>
                                    <p>${rec.desc}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            </div>
        </div>
    `;

    container.innerHTML = html;
}
