import fs from 'fs';

const wordStats = JSON.parse(fs.readFileSync('scratch/word_stats.json', 'utf8'));

// Dictionaries and classification maps
// CEFR levels:
const c1c2List = new Set([
  'commensurate', 'repercussion', 'discretion', 'apprehensive', 'deterrence',
  'delicately', 'omission', 'imperative', 'constitute', 'substantially',
  'coherent', 'recur', 'exorbitant', 'corroborate', 'paradigm', 'synergy',
  'plummet', 'overhaul', 'sluggish', 'garner', 'retrospect', 'feasibility',
  'relegate', 'proprietary', 'expedite', 'scarcity', 'concurrently', 'endure',
  'skeptical', 'daringly', 'unprecedented', 'lucrative', 'scrutinize',
  'meticulous', 'ambiguity', 'inadvertent', 'preclude', 'subsequent', 'alleviate',
  'contingent', 'culminate', 'impetus', 'thriving', 'refurbish', 'disclose',
  'encompass', 'cohesive', 'restraint', 'interpersonal', 'jurisdiction',
  'inclusiveness', 'downturn', 'analytical', 'prospective', 'liaise',
  'vulnerable', 'deteriorate', 'insightful', 'exempt', 'provision',
  'accumulate', 'geothermal', 'substitution', 'tariff', 'contemporary',
  'miscommunication', 'disrepair', 'deplete', 'vested', 'subjective'
]);

const b2List = new Set([
  'compensation', 'accommodate', 'obstacle', 'pension', 'obstruct',
  'compromise', 'incorporate', 'potential', 'concentrate', 'association',
  'reduction', 'adhere to', 'time-consuming', 'dimension', 'bargain',
  'reputation', 'conservative', 'sufficiently', 'consistently', 'come up with',
  'rest assured', 'bring in', 'build up', 'rely on', 'be in charge of',
  'move forward', 'look up to', 'keep up with', 'partner with', 'pose a problem',
  'jump the gun', 'put on hold', 'cover for', 'sort out', 'hand over',
  'fall within', 'verify', 'cite', 'assist', 'calculate', 'audit', 'adopt',
  'revolution', 'directory', 'diversify', 'disperse', 'merchandise', 'commence',
  'disruption', 'consequence', 'acknowledge', 'asset', 'acquire', 'restricted',
  'prohibit', 'fluctuate', 'apprentice', 'terms', 'successive', 'statement',
  'systematically', 'convince', 'complication', 'offset', 'demonstrate',
  'unveil', 'relocate', 'obligate', 'agreement', 'comply', 'regulate',
  'arrangement', 'persuasion', 'duplicate', 'courier', 'outdated', 'engage',
  'establish', 'petition', 'fad', 'accustom', 'adjacent', 'renew', 'anticipate',
  'commend', 'conceal', 'resurface', 'tenant', 'portfolio', 'turnover',
  'assurance', 'entitle', 'duration', 'patron', 'facilitate', 'indicator',
  'specialize', 'recruitment', 'formulate', 'excursion', 'reinforce', 'automate',
  'durable', 'illuminate', 'merger', 'redundant', 'sustainable', 'oversight',
  'predecessor', 'maximize', 'implement', 'allocate', 'disapprove', 'compile',
  'parameter', 'deficit', 'transmit', 'specification', 'commission', 'surge',
  'refrain', 'conjunction', 'equivalent', 'intricate', 'attainment', 'thoroughly',
  'mislabel', 'advocate', 'abruptly', 'reschedule', 'rebound', 'punctually',
  'initiate', 'flawless', 'incentive', 'quota', 'waive', 'acclaim', 'inevitable',
  'reflection', 'accomplished', 'dividend', 'overhead', 'violation', 'briefing',
  'reimburse', 'seasonal', 'constructive', 'candidate', 'dedication', 'deduct',
  'budget', 'elaborate', 'strictly', 'pillar', 'workforce', 'divert', 'justify',
  'inconvenience', 'thorough', 'commemorate', 'availability', 'economize',
  'consultation', 'culinary', 'profess', 'subdivide', 'resilience'
]);

const a2List = new Set([
  'shut down', 'give up', 'fold', 'mix', 'suit', 'bear', 'choose', 'ask',
  'plan', 'change', 'report', 'repair', 'train', 'board', 'check', 'reply',
  'correct', 'disk', 'crew', 'queue', 'earn', 'cheer', 'busy', 'file', 'sort',
  'item', 'add', 'debt', 'boost', 'detail', 'search', 'blind', 'proof',
  'damage', 'hold', 'lead', 'allow', 'delete', 'result', 'site', 'hire',
  'mark', 'select', 'edge', 'fare', 'stage', 'guide', 'habit', 'solve'
]);

// All other words belong to B1 (Intermediate)

// TOEIC Domain mapping
const domainRules = [
  {
    code: 'HR_ADMIN',
    name: 'Hành chính, Nhân sự & Tuyển dụng (HR & Administration)',
    words: [
      'compensation', 'pension', 'recruit', 'recruitment', 'candidate', 'resign',
      'retire', 'apprentice', 'discretion', 'workforce', 'turnover', 'wage',
      'salary', 'job opening', 'cover for', 'step down', 'medical history',
      'medication refill', 'overtime', 'benefit', 'instructor', 'assignment',
      'predecessor', 'housekeeper', 'crew', 'personnel', 'training', 'qualification',
      'absentee', 'hire', 'employ', 'volunteer', 'farewell', 'work sample',
      'supervise', 'vacation', 'leave', 'appoint', 'behavior', 'interpersonal',
      'dedication', 'inclusiveness'
    ]
  },
  {
    code: 'FINANCE_BUSINESS',
    name: 'Tài chính, Kinh doanh & Kế toán (Finance, Business & Accounting)',
    words: [
      'audit', 'accounting', 'financially', 'revenue', 'dividend', 'deficit',
      'budget', 'stock', 'asset', 'portfolio', 'overhead', 'reimburse', 'deduct',
      'downturn', 'plummet', 'economize', 'profitably', 'tariff', 'commission',
      'debt', 'quota', 'bargain', 'account holder', 'value', 'calculate',
      'expenditure', 'discount', 'cost', 'price', 'sale', 'checkout', 'fare',
      'balance', 'balance sheet', 'merger', 'monetary', 'fiscal', 'profit',
      'exorbitant', 'lucrative', 'currency', 'invest', 'enterprise'
    ]
  },
  {
    code: 'NEGOTIATION_LEGAL',
    name: 'Đàm phán, Hợp đồng & Pháp lý (Negotiation & Legal/Contracts)',
    words: [
      'compromise', 'adhere to', 'comply', 'obligate', 'agreement', 'terms',
      'penalty', 'restraint', 'jurisdiction', 'violation', 'waive', 'provision',
      'disclose', 'lock into', 'hand over', 'exempt', 'confidential', 'petition',
      'imperative', 'binding', 'clause', 'settlement', 'dispute', 'breach',
      'concur', 'fall within', 'enforce', 'vested', 'prohibit', 'permit',
      'restricted', 'point taken', 'entitle', 'assurance'
    ]
  },
  {
    code: 'REAL_ESTATE_FACILITIES',
    name: 'Bất động sản & Cơ sở vật chất (Real Estate & Facilities)',
    words: [
      'real estate', 'renovate', 'decorate', 'accommodate', 'lease', 'tenant',
      'refurbish', 'resurface', 'insulation', 'ventilation', 'landscaping',
      'vacant', 'filing cabinet', 'premises', 'venue', 'disrepair', 'property',
      'facility', 'maintenance', 'dimension', 'relocate', 'campus', 'lobby',
      'architecture', 'spacious', 'adjacent'
    ]
  },
  {
    code: 'LOGISTICS_SUPPLY_CHAIN',
    name: 'Logistics, Vận chuyển & Chuỗi cung ứng (Logistics & Supply Chain)',
    words: [
      'transport', 'inventory', 'warehouse', 'back order', 'merchandise',
      'courier', 'checked baggage', 'carry-on bag', 'shopping bag', 'dispatch',
      'expedite', 'deplete', 'supplier', 'vendor', 'carrier', 'cargo',
      'shipment', 'freight', 'consignment', 'pack', 'unpack', 'itinerary',
      'supply', 'delivery', 'arrive', 'scarcity', 'accumulation'
    ]
  },
  {
    code: 'OPERATIONS_PRODUCTION',
    name: 'Vận hành, Sản xuất & Quy trình (Operations & Production)',
    words: [
      'schedule', 'capacity', 'obstruct', 'obstacle', 'manufacture',
      'manufacturer', 'automate', 'troubleshoot', 'systematically', 'specification',
      'overhaul', 'geothermal', 'software', 'reliability', 'implement', 'execute',
      'optimize', 'defect', 'malfunction', 'disruption', 'shut down', 'parameter',
      'protocol', 'workflow', 'streamline', 'operation', 'durable', 'flawless',
      'compatible', 'conduct', 'operate', 'function', 'assemble'
    ]
  }
];

// Process words
const processed = wordStats.map(stat => {
  const lower = stat.word.toLowerCase();
  
  // CEFR
  let cefr = 'B1';
  if (c1c2List.has(lower)) cefr = 'C1-C2';
  else if (b2List.has(lower)) cefr = 'B2';
  else if (a2List.has(lower)) cefr = 'A2';
  else {
    // Check partial matches or default to B1
    if (lower.endsWith('ly') && lower.length > 9) cefr = 'B2';
    else if (lower.endsWith('tion') && lower.length > 10) cefr = 'B2';
    else cefr = 'B1';
  }

  // Domain
  let domainCode = 'COMMUNICATION_MANAGEMENT';
  let domainName = 'Quản trị, Truyền thông & Kỹ năng Công sở (Corporate Communication & General Management)';

  for (const d of domainRules) {
    if (d.words.some(w => lower.includes(w) || w.includes(lower))) {
      domainCode = d.code;
      domainName = d.name;
      break;
    }
  }

  return {
    ...stat,
    cefr,
    domainCode,
    domainName
  };
});

// Calculate statistics
const cefrSummary = {};
const domainSummary = {};

for (const p of processed) {
  // CEFR
  if (!cefrSummary[p.cefr]) {
    cefrSummary[p.cefr] = { count: 0, reviews: 0, r1: 0, r2: 0, r3: 0, r4: 0, words: [] };
  }
  const cs = cefrSummary[p.cefr];
  cs.count++;
  cs.reviews += p.totalReviews;
  cs.r1 += p.ratings[1];
  cs.r2 += p.ratings[2];
  cs.r3 += p.ratings[3];
  cs.r4 += p.ratings[4];
  cs.words.push(p.word);

  // Domain
  if (!domainSummary[p.domainCode]) {
    domainSummary[p.domainCode] = { name: p.domainName, count: 0, reviews: 0, r1: 0, r2: 0, r3: 0, r4: 0 };
  }
  const ds = domainSummary[p.domainCode];
  ds.count++;
  ds.reviews += p.totalReviews;
  ds.r1 += p.ratings[1];
  ds.r2 += p.ratings[2];
  ds.r3 += p.ratings[3];
  ds.r4 += p.ratings[4];
}

console.log('=== KẾT QUẢ PHÂN TẦNG CEFR ===');
for (const [lvl, data] of Object.entries(cefrSummary)) {
  const ret = ((data.r3 + data.r4) / data.reviews * 100).toFixed(2);
  const again = (data.r1 / data.reviews * 100).toFixed(2);
  const hard = (data.r2 / data.reviews * 100).toFixed(2);
  console.log(`${lvl}: ${data.count} từ (${(data.count/653*100).toFixed(1)}%), Reviews: ${data.reviews} | Retention(3+4): ${ret}% | Again(1): ${again}% | Hard(2): ${hard}%`);
}

console.log('\n=== KẾT QUẢ PHÂN BỐ LĨNH VỰC TOEIC ===');
for (const [code, data] of Object.entries(domainSummary)) {
  const ret = ((data.r3 + data.r4) / data.reviews * 100).toFixed(2);
  const again = (data.r1 / data.reviews * 100).toFixed(2);
  console.log(`[${code}] ${data.name}:`);
  console.log(`  Số từ: ${data.count} (${(data.count/653*100).toFixed(1)}%) | Lượt review: ${data.reviews} | Retention: ${ret}% | Again: ${again}%`);
}

// Phrasal Verbs & Preposition Collocations
const phrasals = processed.filter(p => {
  const w = p.word.toLowerCase();
  return (w.includes(' ') || w.includes('-')) && 
         (/to|in|for|from|with|on|out|up|off|of|down|into|ahead|forward/i.test(w) || w.includes('-'));
});

console.log(`\n=== TỔNG HỢP CỤM ĐỘNG TỪ & GIỚI TỪ (PHRASAL VERBS & COLLOCATIONS) ===`);
console.log(`Số lượng cụm: ${phrasals.length}`);
const phrasalsSorted = phrasals.sort((a, b) => b.ratings[1] - a.ratings[1]);
console.log('Top cụm có tỷ lệ lỗi / Again cao:');
for (const ph of phrasalsSorted.slice(0, 15)) {
  const failRate = ((ph.ratings[1] + ph.ratings[2]) / ph.totalReviews * 100).toFixed(1);
  console.log(`- "${ph.word}": Total=${ph.totalReviews}, Again=${ph.ratings[1]}, Hard=${ph.ratings[2]}, Good=${ph.ratings[3]}, Easy=${ph.ratings[4]} | ErrorRate=${failRate}%`);
}

fs.writeFileSync('scratch/linguistic_report_data.json', JSON.stringify({
  cefrSummary,
  domainSummary,
  phrasals: phrasalsSorted,
  processed
}, null, 2));
