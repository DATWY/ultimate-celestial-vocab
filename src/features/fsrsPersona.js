// src/features/fsrsPersona.js — Who I Am: Cognitive Profile & FSRS-7 Parameter Analyzer
import { getState } from '../core/state.js';
import { DEFAULT_FSRS7_PARAMS } from '../core/srs/constants.js';

/**
 * Phân tích chuyên sâu 34 tham số trọng số của mô hình FSRS-7 Dual-Stability.
 * Ngôn ngữ khách quan, học thuật, thực tế, dễ hiểu, không sử dụng từ ngữ hoa mĩ hay ví von văn học.
 * Đánh giá chính xác phản xạ não bộ, độ bền trí nhớ và đưa ra chiến lược học tập thực tế.
 */
export function analyzeFsrs7Persona(userParams, trainedAtTimestamp) {
    const p = (Array.isArray(userParams) && userParams.length === 34) ? userParams : DEFAULT_FSRS7_PARAMS;
    const isPersonalized = (Array.isArray(userParams) && userParams.length === 34 && JSON.stringify(userParams) !== JSON.stringify(DEFAULT_FSRS7_PARAMS));
    const base = DEFAULT_FSRS7_PARAMS;

    // Helper: Tính tỷ lệ lệch % so với mức chuẩn Lab
    const getDeltaPct = (val, baseVal) => {
        if (!baseVal) return 0;
        return ((val - baseVal) / baseVal) * 100;
    };

    // -------------------------------------------------------------
    // 1. KHẢ NĂNG PHỤC HỒI SAU KHI QUÊN (Post-Lapse Retention / Fail Base w[10])
    // -------------------------------------------------------------
    const failBase = p[10];
    const failDelta = getDeltaPct(failBase, base[10]);
    let resilienceScore = Math.min(99, Math.max(20, Math.round(50 + (failDelta * 1.8))));

    let resilienceStatus = "Phục Hồi Chuẩn";
    let resilienceDesc = "Khi quên một từ, bạn phục hồi lại phong độ trí nhớ ở mức tiêu chuẩn sau một vài lần ôn tập.";
    let resilienceBadge = "Tương đương";
    let resilienceBadgeClass = "neutral";

    if (failDelta >= 12) {
        resilienceStatus = "Phục Hồi Rất Nhanh";
        resilienceDesc = `Khi bấm 'Quên' (Again), não bạn vẫn lưu giữ được ${(failBase * 100).toFixed(1)}% dấu vết ký ức cũ (chuẩn Lab: ${(base[10] * 100).toFixed(1)}%). Bạn chỉ cần 1 lần ôn lại là khôi phục độ nhớ dài hạn mà không phải học lại từ đầu.`;
        resilienceBadge = `+${failDelta.toFixed(1)}% Vượt trội`;
        resilienceBadgeClass = "good";
    } else if (failDelta <= -12) {
        resilienceStatus = "Cần Củng Cố Kỹ Khi Quên";
        resilienceDesc = `Khi quên, mức độ lưu giữ giảm xuống còn ${(failBase * 100).toFixed(1)}%. Não bạn có xu hướng muốn học lại từ gốc, do đó cần ôn lặp lại 2-3 lần trong chu kỳ ngắn để xây dựng lại trí nhớ.`;
        resilienceBadge = `${failDelta.toFixed(1)}% Thấp hơn`;
        resilienceBadgeClass = "warn";
    }

    // -------------------------------------------------------------
    // 2. TỐC ĐỘ GIÃN CÁCH DÀI HẠN (Compounding Spacing Factor / sinc w[7])
    // -------------------------------------------------------------
    const sinc = p[7];
    const sincDelta = getDeltaPct(sinc, base[7]);
    let compoundingScore = Math.min(99, Math.max(20, Math.round(50 + (sincDelta * 1.6))));

    let compoundingStatus = "Giãn Cách Chuẩn";
    let compoundingDesc = "Khoảng cách giữa các lần ôn tập giãn ra đều đặn theo cấp số nhân tiêu chuẩn.";
    let compoundingBadge = "Tương đương";
    let compoundingBadgeClass = "neutral";

    if (sincDelta >= 12) {
        compoundingStatus = "Giãn Cách Cực Nhanh";
        compoundingDesc = `Khi bạn nhớ đúng liên tiếp, khoảng cách ngày ôn nhân lên ${sinc.toFixed(2)}x (chuẩn Lab: ${base[7].toFixed(2)}x). Kiến thức nhanh chóng chuyển vào bộ nhớ dài hạn, giúp giảm đáng kể số thẻ phải ôn mỗi ngày.`;
        compoundingBadge = `+${sincDelta.toFixed(1)}% Vượt trội`;
        compoundingBadgeClass = "good";
    } else if (sincDelta <= -12) {
        compoundingStatus = "Giãn Cách Thận Trọng";
        compoundingDesc = `Hệ số giãn cách ở mức ${sinc.toFixed(2)}x. Thuật toán cho bạn gặp lại từ vựng thường xuyên hơn để đảm bảo không bị rơi rụng kiến thức.`;
        compoundingBadge = `${sincDelta.toFixed(1)}% Thấp hơn`;
        compoundingBadgeClass = "warn";
    }

    // -------------------------------------------------------------
    // 3. ĐỘ KHẮT KHE KHI TỰ ĐÁNH GIÁ (Initial Difficulty Perception / D0 w[4])
    // -------------------------------------------------------------
    const diffBase = p[4];
    const diffDelta = getDeltaPct(diffBase, base[4]);
    let frictionScore = Math.min(99, Math.max(20, Math.round(50 + (diffDelta * 1.4))));

    let frictionStatus = "Đánh Giá Cân Bằng";
    let frictionDesc = "Bạn đánh giá độ khó của từ vựng ở mức hợp lý, khách quan giữa các mức Dễ, Nhớ, Khó.";
    let frictionBadge = "Tương đương";
    let frictionBadgeClass = "neutral";

    if (diffDelta >= 12) {
        frictionStatus = "Rất Khắt Khe & Cẩn Thận";
        frictionDesc = `Bạn tự đánh giá độ khó khởi điểm ở mức ${diffBase.toFixed(2)}/10 (chuẩn Lab: ${base[4].toFixed(2)}/10). Bạn có tiêu chuẩn cao, chỉ bấm 'Dễ' khi đã thực sự hiểu sâu, giúp kiến thức một khi đã thuộc thì rất chắc.`;
        frictionBadge = `+${diffDelta.toFixed(1)}% Khắt khe`;
        frictionBadgeClass = "good";
    } else if (diffDelta <= -12) {
        frictionStatus = "Tự Tin & Phóng Khoáng";
        frictionDesc = `Độ khó cảm nhận của bạn là ${diffBase.toFixed(2)}/10. Bạn học với tâm lý thoải mái, dễ dàng tiếp nhận từ mới mà không bị áp lực độ khó.`;
        frictionBadge = `${diffDelta.toFixed(1)}% Thoải mái`;
        frictionBadgeClass = "neutral";
    }

    // -------------------------------------------------------------
    // 4. THỜI GIAN GHI NHỚ TỪ MỚI (Initial Retention Duration / S0 Good w[2])
    // -------------------------------------------------------------
    const s0Good = p[2];
    const s0GoodDelta = getDeltaPct(s0Good, base[2]);
    let absorptionScore = Math.min(99, Math.max(20, Math.round(50 + (s0GoodDelta * 1.3))));

    let absorptionStatus = "Ghi Nhớ Tiêu Chuẩn";
    let absorptionDesc = "Thời gian ghi nhớ tự nhiên sau lần học đầu tiên ở mức ổn định theo chuẩn khoa học.";
    let absorptionBadge = "Tương đương";
    let absorptionBadgeClass = "neutral";

    if (s0GoodDelta >= 12) {
        absorptionStatus = "Nhớ Ban Đầu Rất Lâu";
        absorptionDesc = `Từ mới học lần đầu giữ được ${s0Good.toFixed(1)} ngày (chuẩn Lab: ${base[2].toFixed(1)} ngày). Não bạn mã hóa ấn tượng ban đầu rất nhanh, ít cần lặp lại trong ngày đầu.`;
        absorptionBadge = `+${s0GoodDelta.toFixed(1)}% Nhanh hơn`;
        absorptionBadgeClass = "good";
    } else if (s0GoodDelta <= -8) {
        absorptionStatus = "Cần Củng Cố Ngày Đầu";
        absorptionDesc = `Thời gian nhớ từ mới lần đầu là ${s0Good.toFixed(2)} ngày (thấp hơn chuẩn ${Math.abs(s0GoodDelta).toFixed(1)}%). Bạn cần ưu tiên ôn lại thẻ mới trong vòng 24 giờ đầu để khóa kiến thức vào bộ nhớ dài hạn.`;
        absorptionBadge = `${s0GoodDelta.toFixed(1)}% Cần ôn sớm`;
        absorptionBadgeClass = "warn";
    }

    // -------------------------------------------------------------
    // 5. ĐỘ BỀN VỮNG KÝ ỨC THEO THỜI GIAN (Retention Decay Rate w[23, 24])
    // -------------------------------------------------------------
    const decay2 = p[24];
    const decay2Delta = getDeltaPct(decay2, base[24]);
    let resistanceScore = Math.min(99, Math.max(20, Math.round(50 - (decay2Delta * 1.2))));

    let resistanceStatus = "Suy Giảm Tự Nhiên";
    let resistanceDesc = "Tốc độ hao mòn trí nhớ theo thời gian diễn ra theo đúng đường cong lãng quên tự nhiên.";
    let resistanceBadge = "Tương đương";
    let resistanceBadgeClass = "neutral";

    if (decay2Delta <= -10) {
        resistanceStatus = "Giữ Ký Ức Rất Bền";
        resistanceDesc = `Tốc độ hao mòn trí nhớ chậm hơn chuẩn ${Math.abs(decay2Delta).toFixed(1)}%. Ký ức được lưu giữ ổn định lâu dài ngay cả khi khoảng cách ôn tập kéo dài.`;
        resistanceBadge = `+${Math.abs(decay2Delta).toFixed(1)}% Bền vững`;
        resistanceBadgeClass = "good";
    } else if (decay2Delta >= 10) {
        resistanceStatus = "Nhạy Cảm Với Thời Gian";
        resistanceDesc = `Tốc độ hao mòn đạt ${(decay2 * 100).toFixed(2)}% (chuẩn Lab: ${(base[24] * 100).toFixed(2)}%). Nếu bạn để trễ lịch ôn, từ vựng sẽ bị quên nhanh hơn; việc duy trì streak hàng ngày là yếu tố then chốt.`;
        resistanceBadge = `+${decay2Delta.toFixed(1)}% Đúng hạn`;
        resistanceBadgeClass = "warn";
    }

    // -------------------------------------------------------------
    // 6. XÁC ĐỊNH PHONG CÁCH HỌC TẬP CHỦ ĐẠO (Primary Cognitive Profile)
    // -------------------------------------------------------------
    const candidateTraits = [
        { id: 'compounding', name: 'Tích Lũy Dài Hạn', score: compoundingScore, delta: sincDelta },
        { id: 'resilience', name: 'Phục Hồi Sau Quên', score: resilienceScore, delta: failDelta },
        { id: 'friction', name: 'Độ Khắt Khe & Chuẩn Mực', score: frictionScore, delta: diffDelta },
        { id: 'absorption', name: 'Mã Hóa Ban Đầu', score: absorptionScore, delta: s0GoodDelta },
        { id: 'resistance', name: 'Độ Bền Vững Ký Ức', score: resistanceScore, delta: -decay2Delta }
    ];
    candidateTraits.sort((a, b) => b.delta - a.delta);
    const topTrait = candidateTraits[0];

    let archetype = {
        title: "Người Học Thích Ứng Linh Hoạt",
        enTitle: "Adaptive Balanced Learner",
        icon: "ph-duotone ph-sliders",
        badgeColor: "#38bdf8",
        gradient: "linear-gradient(135deg, #0284c7, #2563eb, #6366f1)",
        coreTraits: [
            { label: "Mã hóa ban đầu", val: "Chuẩn khoa học" },
            { label: "Hệ số giãn cách", val: `${sinc.toFixed(2)}x` },
            { label: "Phục hồi sau quên", val: `${(failBase * 100).toFixed(1)}%` }
        ],
        summary: "Bộ chỉ số của bạn phân bố rất đồng đều, không bị lệch cực đoan. Não bộ của bạn có khả năng thích nghi linh hoạt: từ dễ thì giãn cách nhanh, từ khó thì củng cố nhịp nhàng, tối ưu hóa năng lượng học tập hàng ngày.",
        keyTakeaway: "Duy trì nhịp học ổn định hiện tại, kết hợp học đều đặn mỗi ngày 10-15 phút để phát huy tối đa khả năng thích ứng tự nhiên."
    };

    if (topTrait.id === 'compounding' && topTrait.delta >= 15) {
        archetype = {
            title: "Người Học Tích Lũy Dài Hạn",
            enTitle: "Long-Term Compounding Learner",
            icon: "ph-duotone ph-chart-line-up",
            badgeColor: "#6366f1",
            gradient: "linear-gradient(135deg, #4f46e5, #6366f1, #8b5cf6)",
            coreTraits: [
                { label: "Hệ số giãn cách (sinc)", val: `${sinc.toFixed(2)}x (+${sincDelta.toFixed(1)}%)`, highlight: true },
                { label: "Khả năng phục hồi", val: `${(failBase * 100).toFixed(1)}%` },
                { label: "Độ khắt khe (D0)", val: `${diffBase.toFixed(2)}/10` }
            ],
            summary: `Đặc điểm nổi bật nhất của bạn là tốc độ giãn cách chu kỳ ôn tập cấp số nhân đạt ${sinc.toFixed(2)}x (cao hơn chuẩn Lab ${sincDelta.toFixed(1)}%). Khi bạn nhớ đúng một từ liên tiếp, chu kỳ nhớ dài ra rất nhanh, giúp bạn hấp thụ được kho từ vựng lớn mà không bị nghẽn lịch ôn tập.`,
            keyTakeaway: "Bạn phù hợp nhất với việc mở rộng thêm từ mới đều đặn. Lịch ôn tập dài hạn của bạn sẽ tự động thưa ra mà vẫn giữ nguyên độ thuộc bài."
        };
    } else if (topTrait.id === 'resilience' && topTrait.delta >= 15) {
        archetype = {
            title: "Người Học Phục Hồi Nhanh",
            enTitle: "High-Recovery Learner",
            icon: "ph-duotone ph-arrow-counter-clockwise",
            badgeColor: "#f97316",
            gradient: "linear-gradient(135deg, #ea580c, #f97316, #fb923c)",
            coreTraits: [
                { label: "Bảo tồn sau quên", val: `${(failBase * 100).toFixed(1)}% (+${failDelta.toFixed(1)}%)`, highlight: true },
                { label: "Hệ số giãn cách", val: `${sinc.toFixed(2)}x` },
                { label: "Độ khắt khe (D0)", val: `${diffBase.toFixed(2)}/10` }
            ],
            summary: `Đặc điểm nổi trội nhất của bạn là khả năng phục hồi liên kết nơ-ron rất nhanh sau khi quên. Khi bạn đánh giá 'Quên' (Again), hơn ${(failBase * 100).toFixed(0)}% dấu vết ký ức nền vẫn còn được lưu trữ trong tiềm thức. Bạn chỉ cần 1 lần ôn lại là khôi phục được độ nhớ lâu dài mà không cần học lại từ đầu.`,
            keyTakeaway: "Đừng ngần ngại bấm 'Quên' khi gặp từ lạ. Não bạn khôi phục dữ liệu rất hiệu quả, việc gặp lại từ sẽ củng cố liên kết sâu hơn."
        };
    } else if (topTrait.id === 'friction' && topTrait.delta >= 15) {
        archetype = {
            title: "Người Học Tiêu Chuẩn Cao",
            enTitle: "High-Precision Learner",
            icon: "ph-duotone ph-check-circle",
            badgeColor: "#a855f7",
            gradient: "linear-gradient(135deg, #7e22ce, #9333ea, #c084fc)",
            coreTraits: [
                { label: "Độ khó cơ sở (D0)", val: `${diffBase.toFixed(2)}/10 (+${diffDelta.toFixed(1)}%)`, highlight: true },
                { label: "Hệ số giãn cách", val: `${sinc.toFixed(2)}x` },
                { label: "Khả năng phục hồi", val: `${(failBase * 100).toFixed(1)}%` }
            ],
            summary: `Bạn có tiêu chuẩn tự đánh giá nghiêm túc và khắt khe với bản thân (độ khó khởi điểm ${diffBase.toFixed(2)}/10). Bạn hiếm khi chủ quan bấm 'Dễ' nếu chưa thực sự chắc chắn về ngữ nghĩa. Phong cách này giúp từ vựng một khi đã thuộc thì đạt độ chính xác gần như tuyệt đối.`,
            keyTakeaway: "Đối với những từ bạn đã phản xạ nhận diện trong vòng 2 giây, hãy mạnh dạn bấm 'Dễ' hoặc 'Nhớ' để tránh lặp lại thừa."
        };
    } else if (topTrait.id === 'absorption' && topTrait.delta >= 15) {
        archetype = {
            title: "Người Học Hấp Thụ Nhanh",
            enTitle: "Fast-Acquisition Learner",
            icon: "ph-duotone ph-lightning",
            badgeColor: "#eab308",
            gradient: "linear-gradient(135deg, #ca8a04, #eab308, #fde047)",
            coreTraits: [
                { label: "Thời gian nhớ ngày đầu (S0)", val: `${s0Good.toFixed(1)} ngày (+${s0GoodDelta.toFixed(1)}%)`, highlight: true },
                { label: "Hệ số giãn cách", val: `${sinc.toFixed(2)}x` },
                { label: "Khả năng phục hồi", val: `${(failBase * 100).toFixed(1)}%` }
            ],
            summary: `Não bộ của bạn mã hóa ấn tượng ban đầu rất nhanh với từ mới. Thời gian nhớ tự nhiên lần đầu đạt ${s0Good.toFixed(1)} ngày, giúp bạn lướt qua các từ mới với tốc độ cao mà vẫn nắm bắt được thông tin cốt lõi.`,
            keyTakeaway: "Tận dụng tốc độ hấp thụ nhanh để nạp lượng từ mới dồi dào, kết hợp đọc câu ví dụ thực tế để làm phong phú ngữ cảnh."
        };
    }

    // Highlight data cho card nổi bật
    const highlightData = {
        title: topTrait.name,
        val: topTrait.id === 'compounding' ? `${sinc.toFixed(2)}x` : (topTrait.id === 'resilience' ? `${(failBase * 100).toFixed(1)}%` : `${diffBase.toFixed(2)}/10`),
        deltaText: topTrait.delta >= 0 ? `+${topTrait.delta.toFixed(1)}% so với Lab` : `${topTrait.delta.toFixed(1)}% so với Lab`,
        desc: topTrait.id === 'compounding' ? 'Tốc độ giãn cách chu kỳ dài hạn vượt trội' : (topTrait.id === 'resilience' ? 'Khả năng phục hồi liên kết nơ-ron sau quên rất cao' : 'Tiêu chuẩn tự đánh giá nghiêm ngặt, học sâu')
    };

    // -------------------------------------------------------------
    // 7. CHIẾN LƯỢC HỌC TẬP THỰC TẾ (Actionable & Practical Advice)
    // -------------------------------------------------------------
    const recommendations = [];

    // Lời khuyên 1: Dựa trên sức bật sau khi quên
    if (failBase >= 0.78) {
        recommendations.push({
            icon: "ph-bold ph-arrow-clockwise",
            title: "Tận dụng sức bật phục hồi nhanh",
            desc: `Đừng ngần ngại bấm 'Quên' (Again) khi vấp phải từ lạ. Não bạn giữ lại đến ${(failBase * 100).toFixed(1)}% dấu vết ký ức cũ, nên chỉ cần 1 lần ôn lại là bạn đã lấy lại độ bền trí nhớ mà không tốn công học lại từ đầu.`
        });
    } else {
        recommendations.push({
            icon: "ph-bold ph-repeat",
            title: "Ôn lặp lại kỹ khi quên",
            desc: `Khi đánh giá 'Quên', hãy dành 5-10 giây đọc kỹ lại ví dụ và phát âm từ vựng 2 lần để kích hoạt lại mạng lưới nơ-ron trước khi chuyển sang thẻ tiếp theo.`
        });
    }

    // Lời khuyên 2: Dựa trên chu kỳ ngày đầu S0
    if (s0GoodDelta < 0) {
        recommendations.push({
            icon: "ph-bold ph-clock",
            title: "Nguyên tắc ôn tập trong 24 giờ đầu",
            desc: `Thời gian nhớ từ mới lần đầu của bạn là ${s0Good.toFixed(1)} ngày (thấp hơn mức trung bình). Hãy luôn ưu tiên học từ mới và ôn lại ngay trong ngày đầu tiên để khóa thông tin vào bộ nhớ dài hạn trước khi bị phân rã.`
        });
    } else {
        recommendations.push({
            icon: "ph-bold ph-book-open-text",
            title: "Khai thác ấn tượng ban đầu mạnh mẽ",
            desc: `Thời gian nhớ từ mới lần đầu đạt ${s0Good.toFixed(1)} ngày. Hãy dành thời gian phân tích từ loại, tiền tố/hậu tố để tận dụng tối đa khả năng tiếp thu nhanh của bạn.`
        });
    }

    // Lời khuyên 3: Dựa trên độ khắt khe D0
    if (diffBase >= 7.0) {
        recommendations.push({
            icon: "ph-bold ph-thumbs-up",
            title: "Tự tin bấm 'Nhớ' & 'Dễ' hơn",
            desc: `Bạn có xu hướng tự đánh giá khá khắt khe (${diffBase.toFixed(2)}/10). Với những từ vựng bạn đã nhận diện được ngay trong 2 giây, hãy mạnh dạn bấm 'Nhớ' hoặc 'Dễ' để thuật toán giãn lịch tối ưu, tránh ôn thừa thãi.`
        });
    } else {
        recommendations.push({
            icon: "ph-bold ph-chart-line-up",
            title: "Duy trì Retrievability 90%",
            desc: `Hệ số giãn cách ${sinc.toFixed(2)}x của bạn hoạt động tối ưu nhất ở mức mục tiêu nhớ 90%. Hãy giữ nguyên thông số này để lịch học đạt hiệu suất cao nhất.`
        });
    }

    // Lời khuyên 4: Nguyên tắc duy trì chuỗi học
    recommendations.push({
        icon: "ph-bold ph-calendar-check",
        title: "Duy trì 10-15 phút học đều đặn mỗi ngày",
        desc: `Đặc tính của FSRS-7 là xử lý thẻ đúng hạn. Học đều 10 phút mỗi ngày mang lại hiệu quả ghi nhớ cao hơn 400% so với việc dồn 2 tiếng học một lần vào cuối tuần.`
    });

    return {
        isPersonalized,
        trainedAt: trainedAtTimestamp,
        archetype,
        highlightData,
        pillars: [
            {
                id: 'resilience',
                name: 'Phục Hồi Sau Quên',
                subname: 'Tham số w10',
                icon: 'ph-bold ph-arrow-counter-clockwise',
                score: resilienceScore,
                userVal: `${(failBase * 100).toFixed(1)}%`,
                baseVal: `${(base[10] * 100).toFixed(1)}%`,
                delta: failDelta,
                status: resilienceStatus,
                desc: resilienceDesc,
                badge: resilienceBadge,
                badgeClass: resilienceBadgeClass,
                color: '#f97316'
            },
            {
                id: 'compounding',
                name: 'Giãn Cách Dài Hạn',
                subname: 'Tham số w7',
                icon: 'ph-bold ph-trend-up',
                score: compoundingScore,
                userVal: `${sinc.toFixed(2)}x`,
                baseVal: `${base[7].toFixed(2)}x`,
                delta: sincDelta,
                status: compoundingStatus,
                desc: compoundingDesc,
                badge: compoundingBadge,
                badgeClass: compoundingBadgeClass,
                color: '#6366f1'
            },
            {
                id: 'friction',
                name: 'Độ Khắt Khe Đánh Giá',
                subname: 'Tham số w4',
                icon: 'ph-bold ph-scales',
                score: frictionScore,
                userVal: `${diffBase.toFixed(2)}/10`,
                baseVal: `${base[4].toFixed(2)}/10`,
                delta: diffDelta,
                status: frictionStatus,
                desc: frictionDesc,
                badge: frictionBadge,
                badgeClass: frictionBadgeClass,
                color: '#a855f7'
            },
            {
                id: 'absorption',
                name: 'Thời Gian Nhớ Từ Mới',
                subname: 'Tham số w2',
                icon: 'ph-bold ph-hourglass-high',
                score: absorptionScore,
                userVal: `${s0Good.toFixed(2)} ngày`,
                baseVal: `${base[2].toFixed(2)} ngày`,
                delta: s0GoodDelta,
                status: absorptionStatus,
                desc: absorptionDesc,
                badge: absorptionBadge,
                badgeClass: absorptionBadgeClass,
                color: '#eab308'
            },
            {
                id: 'resistance',
                name: 'Độ Bền Vững Ký Ức',
                subname: 'Tham số w24',
                icon: 'ph-bold ph-shield-check',
                score: resistanceScore,
                userVal: `${(decay2 * 100).toFixed(2)}%`,
                baseVal: `${(base[24] * 100).toFixed(2)}%`,
                delta: -decay2Delta,
                status: resistanceStatus,
                desc: resistanceDesc,
                badge: resistanceBadge,
                badgeClass: resistanceBadgeClass,
                color: '#10b981'
            }
        ],
        comparisonMetrics: {
            s0Good: { icon: 'ph-bold ph-hourglass-high', name: 'Thời gian nhớ từ mới lần đầu (S0)', user: `${s0Good.toFixed(2)} ngày`, base: `${base[2].toFixed(2)}d`, delta: s0GoodDelta, barUserPct: Math.min(100, Math.round((s0Good / 6.0) * 100)), barBasePct: Math.round((base[2] / 6.0) * 100) },
            sinc: { icon: 'ph-bold ph-trend-up', name: 'Hệ số nhân giãn cách ngày ôn (sinc)', user: `${sinc.toFixed(2)}x`, base: `${base[7].toFixed(2)}x`, delta: sincDelta, barUserPct: Math.min(100, Math.round((sinc / 3.5) * 100)), barBasePct: Math.round((base[7] / 3.5) * 100) },
            failBase: { icon: 'ph-bold ph-shield-check', name: 'Tỷ lệ lưu giữ ký ức sau khi quên (w10)', user: `${(failBase * 100).toFixed(1)}%`, base: `${(base[10] * 100).toFixed(1)}%`, delta: failDelta, barUserPct: Math.round(failBase * 100), barBasePct: Math.round(base[10] * 100) },
            diffBase: { icon: 'ph-bold ph-scales', name: 'Độ khó cảm nhận cơ sở (D0)', user: `${diffBase.toFixed(2)}/10`, base: `${base[4].toFixed(2)}/10`, delta: diffDelta, barUserPct: Math.round((diffBase / 10.0) * 100), barBasePct: Math.round((base[4] / 10.0) * 100) },
            decay2: { icon: 'ph-bold ph-clock-countdown', name: 'Tốc độ hao mòn trí nhớ tự nhiên (w24)', user: `${(decay2 * 100).toFixed(2)}%`, base: `${(base[24] * 100).toFixed(2)}%`, delta: decay2Delta, barUserPct: Math.min(100, Math.round((decay2 / 0.15) * 100)), barBasePct: Math.round((base[24] / 0.15) * 100) }
        },
        recommendations
    };
}

/**
 * Render toàn bộ giao diện "Who I Am" vào container DOM.
 * Giao diện trực quan, khoa học, hiện đại với thanh so sánh kép (Dual-bar comparison).
 */
export function renderFsrsPersonaUI(container) {
    if (!container) return;

    const state = getState();
    const userParams = state.userFsrs7Params;
    const trainedAt = state.userFsrs7TrainedAt;

    const data = analyzeFsrs7Persona(userParams, trainedAt);

    // Format badge thời gian huấn luyện
    let statusBadgeHtml = '';
    if (data.isPersonalized) {
        const trainedDateStr = data.trainedAt ? new Date(data.trainedAt).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Gần đây';
        statusBadgeHtml = `
            <div class="whoiam-status-badge personalized">
                <span class="pulse-dot"></span>
                <i class="ph-fill ph-check-circle"></i>
                <span>Bộ Số Cá Nhân Hóa FSRS-7 (Cập nhật: <strong>${trainedDateStr}</strong>)</span>
            </div>
        `;
    } else {
        statusBadgeHtml = `
            <div class="whoiam-status-badge baseline">
                <i class="ph-bold ph-flask"></i>
                <span>Đang Phân Tích Dựa Trên Bộ Chuẩn Phòng Thí Nghiệm (Lab Baseline)</span>
            </div>
        `;
    }

    const html = `
        <div class="whoiam-container">
            <!-- Header Meta Badge -->
            <div class="whoiam-meta-header">
                ${statusBadgeHtml}
            </div>

            <!-- HERO CARD: WHO I AM (SPLIT 2-COLUMN LUXURY DASHBOARD) -->
            <section class="profile-card whoiam-hero-card" style="--hero-glow: ${data.archetype.badgeColor}">
                <div class="whoiam-hero-bg-glow" style="background: ${data.archetype.gradient}"></div>
                <div class="whoiam-hero-split">
                    <!-- Cột Trái: Danh tính nhận thức & Core Traits -->
                    <div class="whoiam-hero-left">
                        <div class="whoiam-identity-row">
                            <div class="whoiam-avatar-glow" style="background: ${data.archetype.gradient}">
                                <i class="${data.archetype.icon}"></i>
                            </div>
                            <div class="whoiam-identity-text">
                                <div class="whoiam-tag-row">
                                    <span class="whoiam-tag" style="border-color: ${data.archetype.badgeColor}; color: ${data.archetype.badgeColor}">
                                        PHONG CÁCH NHẬN THỨC NỔI BẬT
                                    </span>
                                    <span class="whoiam-en-title">${data.archetype.enTitle}</span>
                                </div>
                                <h2 class="whoiam-hero-title">${data.archetype.title}</h2>
                            </div>
                        </div>

                        <p class="whoiam-summary">${data.archetype.summary}</p>
                        
                        <!-- Core Traits Chips -->
                        <div class="whoiam-traits-row">
                            ${data.archetype.coreTraits.map(t => `
                                <div class="whoiam-trait-chip ${t.highlight ? 'highlight' : ''}">
                                    <span class="trait-label">${t.label}:</span>
                                    <strong class="trait-val">${t.val}</strong>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Cột Phải: Thẻ Nổi Trội Nhất (Key Dominance Showcase) -->
                    <div class="whoiam-hero-right">
                        <div class="whoiam-highlight-box">
                            <div class="highlight-top-label">
                                <i class="ph-fill ph-sparkle"></i>
                                <span>CHỈ SỐ NỔI TRỘI NHẤT</span>
                            </div>
                            <div class="highlight-metric-group">
                                <span class="highlight-big-val">${data.highlightData.val}</span>
                                <span class="highlight-delta-tag">${data.highlightData.deltaText}</span>
                            </div>
                            <div class="highlight-trait-name">${data.highlightData.title}</div>
                            <div class="highlight-takeaway-block">
                                <i class="ph-bold ph-lightbulb"></i>
                                <span>${data.archetype.keyTakeaway}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 5 TRỤ CỘT NHẬN THỨC VỚI THANH SO SÁNH TRỰC QUAN (5 CỘT CÂN ĐỐI TRÊN DESKTOP) -->
            <section class="profile-card whoiam-pillars-card">
                <div class="whoiam-section-header">
                    <div class="section-title-group">
                        <h3><i class="ph-bold ph-chart-polar"></i> 5 Trụ Cột Nhận Thức Toán Học</h3>
                        <span class="section-subtitle">So sánh trực quan giữa chỉ số cá nhân hóa của bạn và mức chuẩn trung bình (Lab Baseline)</span>
                    </div>
                </div>

                <div class="whoiam-pillars-grid">
                    ${data.pillars.map(pillar => {
                        return `
                            <div class="pillar-box" style="--pillar-color: ${pillar.color}">
                                <div class="pillar-box-top">
                                    <div class="pillar-name-line">
                                        <i class="${pillar.icon}" style="color: ${pillar.color}"></i>
                                        <h4 class="pillar-name">${pillar.name}</h4>
                                    </div>
                                    <div class="pillar-sub-line">
                                        <span class="pillar-sub">${pillar.subname}</span>
                                        <span class="pillar-status-chip ${pillar.badgeClass}">${pillar.badge}</span>
                                    </div>
                                </div>

                                <!-- Thanh So Sánh Kép Trực Quan (Dual Comparison) -->
                                <div class="dual-bar-wrapper">
                                    <div class="bar-row">
                                        <div class="bar-label-group">
                                            <span class="bar-entity user">Bạn</span>
                                            <strong class="bar-value user">${pillar.userVal}</strong>
                                        </div>
                                        <div class="bar-track">
                                            <div class="bar-fill user" style="width: ${pillar.score}%; background: ${pillar.color}"></div>
                                        </div>
                                    </div>

                                    <div class="bar-row baseline">
                                        <div class="bar-label-group">
                                            <span class="bar-entity base">Chuẩn Lab</span>
                                            <span class="bar-value base">${pillar.baseVal}</span>
                                        </div>
                                        <div class="bar-track base">
                                            <div class="bar-fill base" style="width: 50%;"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Đánh Giá Khoa Học Chi Tiết -->
                                <div class="pillar-verdict-box">
                                    <strong class="verdict-title" style="color: ${pillar.color}">${pillar.status}</strong>
                                    <p class="verdict-text">${pillar.desc}</p>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </section>

            <!-- BENTO GRID: VÂN TAY THAM SỐ TOÁN HỌC & LỜI KHUYÊN THỰC HÀNH -->
            <div class="whoiam-bento-grid">
                <!-- Cột Trái: Bảng Tham Số FSRS-7 Trực Quan -->
                <section class="profile-card whoiam-stats-card">
                    <div class="card-header-simple">
                        <h3><i class="ph-bold ph-sliders-horizontal"></i> Vân Tay Tham Số Trí Nhớ (FSRS-7)</h3>
                        <span class="card-hint">Mức độ tương quan so với chuẩn mô hình</span>
                    </div>

                    <div class="stats-visual-list">
                        ${Object.values(data.comparisonMetrics).map(item => {
                            const isHigher = item.delta >= 0;
                            const deltaText = isHigher ? `+${item.delta.toFixed(1)}%` : `${item.delta.toFixed(1)}%`;
                            const deltaClass = Math.abs(item.delta) < 5 ? 'neutral' : (isHigher ? 'higher' : 'lower');
                            return `
                                <div class="stats-visual-item">
                                    <div class="stats-info-row">
                                        <div class="stats-name">
                                            <i class="${item.icon}"></i>
                                            <span>${item.name}</span>
                                        </div>
                                        <div class="stats-numbers">
                                            <span class="stats-user-num">${item.user}</span>
                                            <span class="stats-base-num">(Lab: ${item.base})</span>
                                            <span class="stats-delta-badge ${deltaClass}">${deltaText}</span>
                                        </div>
                                    </div>
                                    <div class="mini-dual-bar">
                                        <div class="mini-bar-track">
                                            <div class="mini-bar-fill user" style="width: ${item.barUserPct}%;"></div>
                                            <div class="mini-bar-marker base" style="left: ${item.barBasePct}%;" title="Chuẩn Lab: ${item.base}"></div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>

                <!-- Cột Phải: Lời Khuyên Thực Chiến Cá Nhân Hóa -->
                <section class="profile-card whoiam-advice-card">
                    <div class="card-header-simple">
                        <h3><i class="ph-bold ph-compass"></i> Chiến Lược Học Tập Thực Tế</h3>
                        <span class="card-hint">Tối ưu hóa thời gian và năng lượng não bộ</span>
                    </div>

                    <div class="whoiam-advice-list">
                        ${data.recommendations.map((rec, idx) => `
                            <div class="advice-card-item">
                                <div class="advice-num-badge">0${idx + 1}</div>
                                <div class="advice-body">
                                    <div class="advice-header-line">
                                        <i class="${rec.icon}"></i>
                                        <h4>${rec.title}</h4>
                                    </div>
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
