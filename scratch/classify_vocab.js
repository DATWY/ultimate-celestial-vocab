import fs from 'fs';

const wordStats = JSON.parse(fs.readFileSync('scratch/word_stats.json', 'utf8'));

// Domain keywords and semantic mappings
const DOMAINS = {
  HR_ADMIN: {
    name: 'Hành chính, Nhân sự & Tuyển dụng (HR & Administration)',
    test: (w) => /pension|compensat|recruit|resign|candidate|personnel|discretion|evaluate|supervis|colleague|staff|retire|hire|job opening|cover for|step down|medical history|medication|vacation|benefit|appraisal|overtime|shift|payroll|sick leave|absentee|promotion|training|qualification|resume|interview/i.test(w)
  },
  FINANCE_BUSINESS: {
    name: 'Tài chính, Kinh doanh & Kế toán (Finance, Business & Commerce)',
    test: (w) => /audit|stock|revenue|invest|budget|commensurate|fiscal|expenditure|profit|dividend|currency|account holder|tax|reimburse|transaction|portfolio|equity|asset|liability|bank|deposit|discount|bargain|cost|price|sale|quarterly|merger|acquisition/i.test(w)
  },
  NEGOTIATION_LEGAL: {
    name: 'Đàm phán, Hợp đồng & Pháp lý (Negotiation & Legal/Contracts)',
    test: (w) => /compromise|binding|clause|penalty|obligation|adhere to|contract|dispute|settlement|arbitrat|terms|condition|breach|valid|liability|reconcile|stipulat|comply|concur|mandate|imperative|lock into|hand over|agreement|waive/i.test(w)
  },
  REAL_ESTATE_FACILITIES: {
    name: 'Bất động sản & Cơ sở vật chất (Real Estate & Facilities)',
    test: (w) => /renovate|decorate|accommodate|premises|lease|tenant|property|real estate|facility|maintenance|furnish|dimension|architecture|utility|demolish|venue|remodel|occupy|spacious/i.test(w)
  },
  LOGISTICS_SUPPLY_CHAIN: {
    name: 'Logistics, Vận chuyển & Chuỗi cung ứng (Logistics & Supply Chain)',
    test: (w) => /transport|freight|inventory|warehouse|dispatch|carrier|back order|cargo|consignment|deliver|shipment|checked baggage|carry-on|procure|distribut|supplier|vendor|fleet|package|import|export/i.test(w)
  },
  OPERATIONS_PRODUCTION: {
    name: 'Vận hành, Sản xuất & Quy trình (Operations & Production)',
    test: (w) => /schedule|obstruct|obstacle|optimize|maintain|implement|execute|manufacture|assembly|equipment|malfunction|defect|capacity|throughput|shut down|specification|system|protocol|workflow|streamline/i.test(w)
  },
  GENERAL_WORKPLACE_COMMUNICATION: {
    name: 'Giao tiếp công sở & Tác phong làm việc (Workplace Communication & Soft Skills)',
    test: (w) => true // fallback
  }
};

// Standard CEFR Classification reference based on CEFR profile / Cambridge / Oxford
// C1/C2: sophisticated, highly academic, nuance verbs/adjectives/abstract nouns
// B2: corporate workplace, high frequency in TOEIC 750-850
// B1: intermediate general business, TOEIC 500-700
// A2: foundational vocabulary
const CEFR_RULES = [
  // C1 / C2 High tier
  {
    level: 'C1-C2',
    test: (w) => /commensurate|repercussion|discretion|apprehensive|deterrence|delicately|omission|imperative|constitute|inadvertent|preclude|substantially|coheren|recur|subsequent|feasible|stringent|alleviate|contingent|culminat|unprecedented|lucrative|scrutin|meticulous|ambiguity|produc|prominently|aggres|endure|sacrif|critic|exorbitant|retrospect|impetus|compliment/i.test(w)
  },
  // B2 Upper-Intermediate
  {
    level: 'B2',
    test: (w) => /compensat|accommodat|obstacle|pension|obstruct|compromise|incorporate|potential|concentrate|association|reduction|adhere to|time-consuming|dimension|bargain|reputation|conservative|sufficiently|consistently|come up with|rest assured|bring in|build up|rely on|be in charge of|move forward|look up to|keep up with|partner with|pose a problem|jump the gun|put on hold|cover for|sort out|hand over|fall within|verify|cite|assist|calculate|audit|adopt|revolution|directory|modify|distinguish|innovat|revenue|objective|initiative|prospect|collaborat|anticipat|resolve|priorit|efficiency|legislation|comply/i.test(w)
  },
  // B1 Intermediate
  {
    level: 'B1',
    test: (w) => /decorate|transport|inform|renovate|stock|imply|token|currently|schedule|owe|address|delay|eye-catching|call in|be aware of|look forward to|real estate|make a change|as needed|medical history|back order|deal with|fill out|lock into|give up|get in touch|out of the office|take part in|account holder|a plus|long-term|home to|press release|get out of|pick up|like-minded|be made of|job opening|catch up|take out|filing cabinet|ahead of|by all means|tasting menu|go ahead|in shape|get the word out|be ready for|take one's chances|hit the store|cut to the chase|carry-on bag|medication refill|work around|pose for|put together|bring together|appointment with|work sample|point taken|set up|contribute to|shopping bag|as we speak|step down|talk back to|follow up|go for a walk|illustrate with|following afternoon|due to|checked baggage|engineered for|no later than|identify|desire|expand|mention|prepare|suggest|confirm|cancel|remind|arrange|convenient|suitable|request/i.test(w)
  },
  // A2 Elementary
  {
    level: 'A2',
    test: (w) => /shut down|help|start|finish|open|close|buy|sell|clean|send|receive|call|meet|plan|visit|travel|arrive|leave/i.test(w)
  }
];

const results = [];
const cefrCounts = { 'A2': 0, 'B1': 0, 'B2': 0, 'C1-C2': 0 };
const domainCounts = {};
for (const k of Object.keys(DOMAINS)) {
  domainCounts[k] = 0;
}

for (const stat of wordStats) {
  const w = stat.word;

  // Determine CEFR
  let cefr = 'B1'; // default fallback
  for (const r of CEFR_RULES) {
    if (r.test(w)) {
      cefr = r.level;
      break;
    }
  }
  cefrCounts[cefr] = (cefrCounts[cefr] || 0) + 1;

  // Determine Domain
  let domain = 'GENERAL_WORKPLACE_COMMUNICATION';
  for (const [k, d] of Object.entries(DOMAINS)) {
    if (k !== 'GENERAL_WORKPLACE_COMMUNICATION' && d.test(w)) {
      domain = k;
      break;
    }
  }
  domainCounts[domain]++;

  results.push({
    ...stat,
    cefr,
    domain,
    domainName: DOMAINS[domain].name
  });
}

console.log(`\n=== PHÂN TẦNG CEFR (653 TỪ VỰNG) ===`);
for (const [lvl, cnt] of Object.entries(cefrCounts)) {
  console.log(`${lvl}: ${cnt} từ (${(cnt / wordStats.length * 100).toFixed(1)}%)`);
}

console.log(`\n=== PHÂN BỐ LĨNH VỰC BÀI THI TOEIC ===`);
for (const [k, cnt] of Object.entries(domainCounts)) {
  console.log(`- ${DOMAINS[k].name}: ${cnt} từ (${(cnt / wordStats.length * 100).toFixed(1)}%)`);
}

// Phân tích tỷ lệ rating theo từng nhóm CEFR
console.log(`\n=== TỶ LỆ GHI NHỚ THEO TỪNG CẤP ĐỘ CEFR ===`);
for (const lvl of ['A2', 'B1', 'B2', 'C1-C2']) {
  const wordsInLvl = results.filter(r => r.cefr === lvl);
  let r1 = 0, r2 = 0, r3 = 0, r4 = 0, total = 0;
  for (const w of wordsInLvl) {
    r1 += w.ratings[1];
    r2 += w.ratings[2];
    r3 += w.ratings[3];
    r4 += w.ratings[4];
    total += w.totalReviews;
  }
  const retention = ((r3 + r4) / total * 100).toFixed(2);
  const failure = ((r1 + r2) / total * 100).toFixed(2);
  console.log(`Cấp độ ${lvl} (${wordsInLvl.length} từ, ${total} lượt review):`);
  console.log(`  Good/Easy (3+4): ${retention}% | Again/Hard (1+2): ${failure}% (Again: ${(r1/total*100).toFixed(1)}%, Hard: ${(r2/total*100).toFixed(1)}%)`);
}

fs.writeFileSync('scratch/full_classification.json', JSON.stringify(results, null, 2));
console.log('\nWrote full_classification.json successfully');
