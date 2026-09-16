// src/features/fsrsPersona.js — Who I Am: Chân Dung Não Bộ & Siêu Năng Lực Trí Nhớ FSRS-7
import { getState } from '../core/state.js';
import { DEFAULT_FSRS7_PARAMS } from '../core/srs/constants.js';

/**
 * Phân tích 34 tham số FSRS-7 thành Chân Dung Não Bộ trực quan, dễ hiểu, sinh động.
 * Chuyển hóa toán học phức tạp thành 4 Siêu Năng Lực Trí Não (0-100 điểm) và 3 Bí Kíp Thực Chiến.
 */
export function analyzeFsrs7Persona(userParams, trainedAtTimestamp) {
    const p = (Array.isArray(userParams) && userParams.length === 34) ? userParams : DEFAULT_FSRS7_PARAMS;
    const isPersonalized = (Array.isArray(userParams) && userParams.length === 34 && JSON.stringify(userParams) !== JSON.stringify(DEFAULT_FSRS7_PARAMS));
    const base = DEFAULT_FSRS7_PARAMS;

    const getDeltaPct = (val, baseVal) => {
        if (!baseVal) return 0;
        return ((val - baseVal) / baseVal) * 100;
    };

    // 1. TỐC ĐỘ TIẾP THU (Learning Speed) - Dựa vào S0 Good (p[2], base = 3.92d)
    const s0Good = p[2];
    const s0GoodDelta = getDeltaPct(s0Good, base[2]);
    const learningScore = Math.min(99, Math.max(50, Math.round(75 + (s0GoodDelta * 0.6))));
    let learningStatus = "Tiếp thu nhanh nhẹn";
    let learningDesc = "Bạn nắm bắt từ mới rất nhanh, dễ dàng ghi nhớ ngữ nghĩa cốt lõi ngay từ lần chạm đầu tiên.";
    if (s0GoodDelta >= 15) {
        learningStatus = "Nhạy bén xuất sắc";
        learningDesc = "Não bạn mã hóa ấn tượng ban đầu cực mạnh, từ mới nhớ được tới " + s0Good.toFixed(1) + " ngày ngay sau lần học đầu!";
    } else if (s0GoodDelta <= -10) {
        learningStatus = "Tiếp thu cẩn trọng";
        learningDesc = "Bạn có xu hướng muốn ôn lại từ mới trong 24 giờ đầu để kiến thức kịp ăn sâu vào trí nhớ dài hạn.";
    }

    // 2. ĐỘ BỀN KÝ ỨC (Memory Stamina) - Dựa vào sinc (p[7], base = 1.98x)
    const sinc = p[7];
    const sincDelta = getDeltaPct(sinc, base[7]);
    const staminaScore = Math.min(99, Math.max(50, Math.round(75 + (sincDelta * 0.7))));
    let staminaStatus = "Khắc sâu bền bỉ";
    let staminaDesc = "Mỗi khi trả lời đúng liên tiếp, khoảng cách ngày ôn giãn cách đều đặn, không sợ bị quên rơi rụng.";
    if (sincDelta >= 15) {
        staminaStatus = "Siêu bền dài hạn";
        staminaDesc = "Chu kỳ nhớ của bạn nhân lên " + sinc.toFixed(1) + "x mỗi lượt đúng! Từ vựng một khi đã thuộc thì khắc sâu như tạc vào đá.";
    } else if (sincDelta <= -10) {
        staminaStatus = "Giữ nhịp an toàn";
        staminaDesc = "Khoảng cách ôn tập được thuật toán giữ ở nhịp độ thận trọng " + sinc.toFixed(1) + "x để bạn luôn an tâm không bị quên.";
    }

    // 3. SỨC BẬT PHỤC HỒI (Bounce Back) - Dựa vào failBase (p[10], base = 0.702)
    const failBase = p[10];
    const failDelta = getDeltaPct(failBase, base[10]);
    const bounceScore = Math.min(99, Math.max(50, Math.round(75 + (failDelta * 0.7))));
    let bounceStatus = "Bật lại tức thì";
    let bounceDesc = "Khi lỡ bấm 'Quên', não bạn vẫn giữ lại gốc rễ ký ức, chỉ cần ôn lướt 1 lần là lấy lại phong độ ngay!";
    if (failDelta >= 15) {
        bounceStatus = "Phục hồi thần tốc";
        bounceDesc = "Khả năng phục hồi siêu việt! Khi quên, bạn vẫn lưu giữ " + (failBase * 100).toFixed(0) + "% dấu vết cũ, không bao giờ phải học lại từ con số 0.";
    } else if (failDelta <= -10) {
        bounceStatus = "Cần ôn kỹ khi quên";
        bounceDesc = "Khi gặp từ đã quên, não bạn muốn xây lại nền móng vững chắc, nên dành thêm 5 giây đọc kỹ ví dụ để nhớ sâu hơn.";
    }

    // 4. ĐỘ CHUẨN XÁC & KỸ TÍNH (Precision & Focus) - Dựa vào D0 (p[4], base = 6.17/10)
    const diffBase = p[4];
    const diffDelta = getDeltaPct(diffBase, base[4]);
    const precisionScore = Math.min(99, Math.max(50, Math.round(75 + (diffDelta * 0.6))));
    let precisionStatus = "Đánh giá chuẩn xác";
    let precisionDesc = "Tiêu chuẩn tự đánh giá hợp lý, khách quan và biết rõ mức độ tự tin của mình ở từng từ vựng.";
    if (diffDelta >= 15) {
        precisionStatus = "Kỹ tính & Cầu toàn";
        precisionDesc = "Bạn có tiêu chuẩn khắt khe, chỉ bấm 'Dễ' khi đã thực sự hiểu sâu. Nhờ vậy từ vựng một khi đã nắm là chắc như đinh đóng cột!";
    } else if (diffDelta <= -10) {
        precisionStatus = "Tự tin & Phóng khoáng";
        precisionDesc = "Bạn học với tinh thần thoải mái, không ngại thử thách và tiếp nhận từ mới với tâm thế tự tin cao.";
    }

    // XÁC ĐỊNH HÌNH MẪU NGƯỜI HỌC (PERSONA ARCHETYPE)
    const traits = [
        { id: 'learning', name: 'Tiếp Thu Thần Tốc', score: learningScore, delta: s0GoodDelta },
        { id: 'stamina', name: 'Độ Bền Ký Ức', score: staminaScore, delta: sincDelta },
        { id: 'bounce', name: 'Sức Bật Phục Hồi', score: bounceScore, delta: failDelta },
        { id: 'precision', name: 'Độ Chuẩn Xác', score: precisionScore, delta: diffDelta }
    ];
    traits.sort((a, b) => b.score - a.score);
    const dominantTrait = traits[0];

    let archetype = {
        title: "Chiến Binh Thích Ứng",
        enTitle: "Adaptive Explorer",
        icon: "ph-fill ph-compass",
        badgeColor: "#38bdf8",
        gradient: "linear-gradient(135deg, #0284c7, #2563eb, #6366f1)",
        slogan: "Não bộ cân bằng hoàn hảo, điều tiết nhịp học linh hoạt và bền bỉ!",
        highlightBadge: "Đa Năng Toàn Diện",
        traits: [
            { label: "Tiếp thu", val: `${learningScore}/100`, icon: "ph-lightning" },
            { label: "Độ bền", val: `${staminaScore}/100`, icon: "ph-hourglass" },
            { label: "Sức bật", val: `${bounceScore}/100`, icon: "ph-arrows-counter-clockwise" }
        ]
    };

    if (dominantTrait.id === 'learning' && dominantTrait.delta >= 10) {
        archetype = {
            title: "Tia Chớp Nhanh Nhẹn",
            enTitle: "Fast Sprinter",
            icon: "ph-fill ph-lightning",
            badgeColor: "#eab308",
            gradient: "linear-gradient(135deg, #ca8a04, #eab308, #f59e0b)",
            slogan: "Nạp từ mới cực nhanh, phản xạ sắc bén ngay từ lần học đầu tiên!",
            highlightBadge: "Tốc Độ Dẫn Đầu",
            traits: [
                { label: "Nhớ ngày đầu", val: `${s0Good.toFixed(1)} ngày`, icon: "ph-lightning" },
                { label: "Tốc độ nạp", val: "Xuất sắc", icon: "ph-rocket" },
                { label: "Tiếp thu", val: `${learningScore}/100`, icon: "ph-sparkle" }
            ]
        };
    } else if (dominantTrait.id === 'stamina' && dominantTrait.delta >= 10) {
        archetype = {
            title: "Pháo Đài Kiên Cố",
            enTitle: "Memory Vault",
            icon: "ph-fill ph-shield-check",
            badgeColor: "#6366f1",
            gradient: "linear-gradient(135deg, #4338ca, #6366f1, #8b5cf6)",
            slogan: "Trí nhớ dài hạn vững chắc, càng ôn càng nhớ sâu không thể phai mờ!",
            highlightBadge: "Bền Bỉ Vô Địch",
            traits: [
                { label: "Giãn cách dài", val: `${sinc.toFixed(1)}x`, icon: "ph-trend-up" },
                { label: "Độ giữ từ", val: "Rất lâu", icon: "ph-lock" },
                { label: "Độ bền", val: `${staminaScore}/100`, icon: "ph-shield" }
            ]
        };
    } else if (dominantTrait.id === 'bounce' && dominantTrait.delta >= 10) {
        archetype = {
            title: "Phượng Hoàng Tái Sinh",
            enTitle: "Quick Phoenix",
            icon: "ph-fill ph-fire",
            badgeColor: "#f97316",
            gradient: "linear-gradient(135deg, #c2410c, #ea580c, #f97316)",
            slogan: "Khả năng phục hồi siêu tốc: quên chỉ là bước đệm để nhớ chắc hơn!",
            highlightBadge: "Bật Dậy Siêu Tốc",
            traits: [
                { label: "Giữ sau quên", val: `${(failBase * 100).toFixed(0)}%`, icon: "ph-arrows-counter-clockwise" },
                { label: "Khôi phục", val: "1 lần ôn", icon: "ph-arrow-clockwise" },
                { label: "Sức bật", val: `${bounceScore}/100`, icon: "ph-fire" }
            ]
        };
    } else if (dominantTrait.id === 'precision' && dominantTrait.delta >= 10) {
        archetype = {
            title: "Xạ Thủ Chuẩn Xác",
            enTitle: "Precision Master",
            icon: "ph-fill ph-target",
            badgeColor: "#10b981",
            gradient: "linear-gradient(135deg, #047857, #10b981, #14b8a6)",
            slogan: "Học sâu, đánh giá nghiêm túc, một khi đã thuộc là không sai sót!",
            highlightBadge: "Chính Xác Tuyệt Đối",
            traits: [
                { label: "Tiêu chuẩn", val: "Khắt khe", icon: "ph-check-circle" },
                { label: "Độ chắc", val: "Tuyệt đối", icon: "ph-seal-check" },
                { label: "Chuẩn xác", val: `${precisionScore}/100`, icon: "ph-target" }
            ]
        };
    }

    // 4 SIÊU NĂNG LỰC TRÍ NÃO
    const superpowers = [
        {
            id: 'learning',
            name: 'Tốc Độ Tiếp Thu',
            sub: 'Khả năng nạp từ mới',
            score: learningScore,
            status: learningStatus,
            desc: learningDesc,
            color: '#eab308',
            gradient: 'linear-gradient(90deg, #ca8a04, #eab308)',
            icon: 'ph-fill ph-lightning',
            unit: '/100'
        },
        {
            id: 'stamina',
            name: 'Độ Bền Ký Ức',
            sub: 'Trí nhớ dài hạn',
            score: staminaScore,
            status: staminaStatus,
            desc: staminaDesc,
            color: '#6366f1',
            gradient: 'linear-gradient(90deg, #4f46e5, #8b5cf6)',
            icon: 'ph-fill ph-hourglass-high',
            unit: '/100'
        },
        {
            id: 'bounce',
            name: 'Sức Bật Phục Hồi',
            sub: 'Phản xạ khi quên thẻ',
            score: bounceScore,
            status: bounceStatus,
            desc: bounceDesc,
            color: '#f97316',
            gradient: 'linear-gradient(90deg, #ea580c, #fb923c)',
            icon: 'ph-fill ph-arrow-counter-clockwise',
            unit: '/100'
        },
        {
            id: 'precision',
            name: 'Độ Chuẩn Xác',
            sub: 'Mức độ hiểu sâu',
            score: precisionScore,
            status: precisionStatus,
            desc: precisionDesc,
            color: '#10b981',
            gradient: 'linear-gradient(90deg, #059669, #34d399)',
            icon: 'ph-fill ph-target',
            unit: '/100'
        }
    ];

    // 3 BÍ KÍP ĐỈNH CAO THỰC CHIẾN (PRO-TIPS)
    const proTips = [
        {
            num: "01",
            icon: "ph-bold ph-thumbs-up",
            color: "#38bdf8",
            title: "Tự tin bấm 'Nhớ' và 'Dễ' hơn",
            desc: "Khi bạn nhận diện được từ trong vòng 2 giây, hãy mạnh dạn bấm 'Nhớ' hoặc 'Dễ' để thuật toán tự động giãn lịch thông minh, tránh học lặp thừa thãi."
        },
        {
            num: "02",
            icon: "ph-bold ph-rocket-launch",
            color: "#f59e0b",
            title: "Khai thác thế mạnh tiếp thu",
            desc: "Não bạn nạp từ mới rất hiệu quả. Hãy duy trì thêm 10-15 từ mới mỗi ngày và đọc lướt câu ví dụ để làm phong phú ngữ cảnh giao tiếp."
        },
        {
            num: "03",
            icon: "ph-bold ph-fire",
            color: "#ec4899",
            title: "Bí mật: 10 phút học đều mỗi ngày",
            desc: "Thuật toán FSRS-7 hoạt động tốt nhất khi ôn đúng hạn. Chỉ cần 10 phút mỗi ngày mang lại hiệu quả bền bỉ gấp 4 lần việc dồn dập vào cuối tuần!"
        }
    ];

    // DỮ LIỆU KỸ THUẬT FSRS-7 NÂNG CAO (Cho Accordion tùy chọn)
    const decay2 = p[24];
    const techMetrics = [
        { name: "Thời gian nhớ từ mới (S0)", userVal: `${s0Good.toFixed(2)} ngày`, labVal: `${base[2].toFixed(2)} ngày`, delta: s0GoodDelta, desc: "Khoảng cách ngày ôn đầu tiên khi bấm Good" },
        { name: "Hệ số giãn cách dài hạn (sinc)", userVal: `${sinc.toFixed(2)}x`, labVal: `${base[7].toFixed(2)}x`, delta: sincDelta, desc: "Mức nhân cấp số nhân chu kỳ nhớ khi liên tục đúng" },
        { name: "Tỷ lệ bảo tồn sau khi quên (w10)", userVal: `${(failBase * 100).toFixed(1)}%`, labVal: `${(base[10] * 100).toFixed(1)}%`, delta: failDelta, desc: "Dấu vết ký ức còn giữ lại trong tiềm thức khi bấm Again" },
        { name: "Độ khó cảm nhận cơ sở (D0)", userVal: `${diffBase.toFixed(2)}/10`, labVal: `${base[4].toFixed(2)}/10`, delta: diffDelta, desc: "Mức độ khắt khe khi tự chấm điểm thẻ bài" },
        { name: "Tốc độ hao mòn ký ức tự nhiên (w24)", userVal: `${(decay2 * 100).toFixed(2)}%`, labVal: `${(base[24] * 100).toFixed(2)}%`, delta: getDeltaPct(decay2, base[24]), desc: "Tốc độ suy giảm trí nhớ theo đường cong lãng quên" }
    ];

    return {
        isPersonalized,
        trainedAt: trainedAtTimestamp,
        archetype,
        superpowers,
        proTips,
        techMetrics
    };
}

/**
 * Render giao diện "Who I Am" mới: Đơn giản, Trực quan, Sinh động, Hiện đại.
 */
export function renderFsrsPersonaUI(container) {
    if (!container) return;

    const state = getState();
    const userParams = state.userFsrs7Params;
    const trainedAt = state.userFsrs7TrainedAt;

    const data = analyzeFsrs7Persona(userParams, trainedAt);

    let statusBadgeHtml = '';
    if (data.isPersonalized) {
        const trainedDateStr = data.trainedAt ? new Date(data.trainedAt).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Gần đây';
        statusBadgeHtml = `
            <div class="whoiam-status-badge personalized">
                <span class="pulse-dot"></span>
                <i class="ph-fill ph-check-circle"></i>
                <span>Đã Cá Nhân Hóa Theo Não Bộ Bạn (Cập nhật: <strong>${trainedDateStr}</strong>)</span>
            </div>
        `;
    } else {
        statusBadgeHtml = `
            <div class="whoiam-status-badge baseline">
                <i class="ph-bold ph-sparkle"></i>
                <span>Chân Dung Tiêu Chuẩn Khoa Học (Mô hình FSRS-7 Lab)</span>
            </div>
        `;
    }

    const html = `
        <div class="whoiam-v2-container">
            <!-- Header Meta Badge -->
            <div class="whoiam-meta-header">
                ${statusBadgeHtml}
            </div>

            <!-- 1. THẺ CĂN CƯỚC NÃO BỘ (HERO IDENTITY CARD) -->
            <section class="whoiam-identity-card" style="--persona-accent: ${data.archetype.badgeColor}">
                <div class="identity-card-glow" style="background: ${data.archetype.gradient}"></div>
                <div class="identity-card-inner">
                    <div class="identity-left-column">
                        <div class="identity-avatar-box" style="background: ${data.archetype.gradient}">
                            <i class="${data.archetype.icon}"></i>
                        </div>
                        <div class="identity-title-box">
                            <div class="identity-tag-badge">
                                <span>PHONG CÁCH HỌC TẬP CHỦ ĐẠO</span>
                                <span class="identity-en">${data.archetype.enTitle}</span>
                            </div>
                            <h2 class="identity-name">${data.archetype.title}</h2>
                            <p class="identity-slogan">${data.archetype.slogan}</p>
                        </div>
                    </div>

                    <div class="identity-right-column">
                        <div class="identity-highlight-pill">
                            <i class="ph-fill ph-crown"></i>
                            <span>${data.archetype.highlightBadge}</span>
                        </div>
                        <div class="identity-traits-grid">
                            ${data.archetype.traits.map(t => `
                                <div class="identity-trait-box">
                                    <span class="trait-lbl"><i class="ph ${t.icon}"></i> ${t.label}</span>
                                    <strong class="trait-val">${t.val}</strong>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </section>

            <!-- 2. BẢNG 4 SIÊU NĂNG LỰC TRÍ NÃO (4 SUPERPOWER STAT CARDS) -->
            <section class="whoiam-superpowers-section">
                <div class="section-title-line">
                    <div class="title-with-icon">
                        <i class="ph-fill ph-brain"></i>
                        <h3>4 Siêu Năng Lực Trí Não</h3>
                    </div>
                    <span class="title-sub">Thước đo phản xạ và độ bền ghi nhớ (Thang điểm 100)</span>
                </div>

                <div class="superpowers-grid">
                    ${data.superpowers.map(sp => `
                        <div class="superpower-card" style="--sp-color: ${sp.color}">
                            <div class="sp-card-header">
                                <div class="sp-icon-box" style="background: ${sp.gradient}">
                                    <i class="${sp.icon}"></i>
                                </div>
                                <div class="sp-title-group">
                                    <h4 class="sp-name">${sp.name}</h4>
                                    <span class="sp-sub">${sp.sub}</span>
                                </div>
                                <div class="sp-score-box">
                                    <span class="sp-score-num">${sp.score}</span>
                                    <span class="sp-score-unit">${sp.unit}</span>
                                </div>
                            </div>

                            <div class="sp-bar-container">
                                <div class="sp-bar-track">
                                    <div class="sp-bar-fill" style="width: ${sp.score}%; background: ${sp.gradient};"></div>
                                </div>
                            </div>

                            <div class="sp-card-footer">
                                <div class="sp-status-chip">
                                    <i class="ph-fill ph-sparkle"></i>
                                    <span>${sp.status}</span>
                                </div>
                                <p class="sp-desc">${sp.desc}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>

            <!-- 3. 3 BÍ KÍP ĐỈNH CAO THỰC CHIẾN (ACTIONABLE PRO-TIPS) -->
            <section class="whoiam-protips-section">
                <div class="section-title-line">
                    <div class="title-with-icon">
                        <i class="ph-fill ph-lightbulb-filament"></i>
                        <h3>3 Bí Kíp Học Tập Đỉnh Cao</h3>
                    </div>
                    <span class="title-sub">Chiến lược thực tế giúp bạn học ít hơn nhưng nhớ lâu hơn</span>
                </div>

                <div class="protips-grid">
                    ${data.proTips.map(tip => `
                        <div class="protip-card">
                            <div class="protip-num-badge" style="color: ${tip.color}; border-color: ${tip.color};">
                                ${tip.num}
                            </div>
                            <div class="protip-content">
                                <div class="protip-header">
                                    <i class="${tip.icon}" style="color: ${tip.color};"></i>
                                    <h4>${tip.title}</h4>
                                </div>
                                <p>${tip.desc}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>

            <!-- 4. NGĂN XẾP TRƯỢT: THÔNG SỐ KỸ THUẬT FSRS-7 NÂNG CAO (COLLAPSIBLE) -->
            <section class="whoiam-tech-drawer">
                <button type="button" id="btn-toggle-fsrs-tech" class="btn-toggle-tech">
                    <div class="btn-toggle-left">
                        <i class="ph-bold ph-sliders-horizontal"></i>
                        <span>Xem chi tiết thông số toán học FSRS-7 (Dành cho người thích nghiên cứu)</span>
                    </div>
                    <i class="ph-bold ph-caret-down toggle-caret" id="fsrs-tech-caret"></i>
                </button>

                <div id="fsrs-tech-panel" class="fsrs-tech-panel hidden">
                    <div class="tech-table-container">
                        <table class="tech-metrics-table">
                            <thead>
                                <tr>
                                    <th>Chỉ Số Trí Nhớ</th>
                                    <th>Cá Nhân Của Bạn</th>
                                    <th>Chuẩn Lab</th>
                                    <th>So Sánh</th>
                                    <th>Ý Nghĩa Khoa Học</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.techMetrics.map(m => {
                                    const isGood = m.delta >= 0;
                                    const deltaText = m.delta >= 0 ? `+${m.delta.toFixed(1)}%` : `${m.delta.toFixed(1)}%`;
                                    const badgeClass = Math.abs(m.delta) < 5 ? 'neutral' : (isGood ? 'positive' : 'negative');
                                    return `
                                        <tr>
                                            <td><strong>${m.name}</strong></td>
                                            <td class="tech-user-val">${m.userVal}</td>
                                            <td class="tech-lab-val">${m.labVal}</td>
                                            <td><span class="tech-delta-pill ${badgeClass}">${deltaText}</span></td>
                                            <td class="tech-desc-text">${m.desc}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>
    `;

    container.innerHTML = html;

    // Gắn sự kiện mở/đóng ngăn kéo thông số kỹ thuật
    const toggleBtn = container.querySelector('#btn-toggle-fsrs-tech');
    const panel = container.querySelector('#fsrs-tech-panel');
    const caret = container.querySelector('#fsrs-tech-caret');

    if (toggleBtn && panel) {
        toggleBtn.onclick = () => {
            const isHidden = panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !isHidden);
            if (caret) {
                caret.className = isHidden ? 'ph-bold ph-caret-up toggle-caret' : 'ph-bold ph-caret-down toggle-caret';
            }
            toggleBtn.classList.toggle('active', isHidden);
        };
    }
}
