import fs from 'fs';

const filePath = 'C:/Users/ASUS/Downloads/celestial_review_logs_2026-10-07.json';
const raw = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(raw);
const logs = data.logs;

console.log(`Version: ${data.version}, ExportedAt: ${data.exportedAt}, Total in wrapper: ${data.totalReviews}, Logs len: ${logs.length}`);
console.log('Sample entry 0:', logs[0]);
console.log('Sample entry 1:', logs[1]);

// Collect statistics
const wordStats = new Map();
const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
let totalInterval = 0;
let minDate = new Date();
let maxDate = new Date(0);

for (const log of logs) {
  const word = (log.english || log.word || '').trim();
  const rating = Number(log.rating);
  const t = Number(log.t || 0);
  const ts = new Date(log.ts);

  if (ts < minDate) minDate = ts;
  if (ts > maxDate) maxDate = ts;

  ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
  totalInterval += t;

  if (!wordStats.has(word)) {
    wordStats.set(word, {
      word,
      totalReviews: 0,
      ratings: { 1: 0, 2: 0, 3: 0, 4: 0 },
      maxT: 0,
      minT: Infinity,
      intervals: [],
      history: [],
      lastRating: rating,
      firstTs: log.ts,
      lastTs: log.ts,
    });
  }

  const stat = wordStats.get(word);
  stat.totalReviews += 1;
  stat.ratings[rating] = (stat.ratings[rating] || 0) + 1;
  if (t > stat.maxT) stat.maxT = t;
  if (t < stat.minT) stat.minT = t;
  stat.intervals.push(t);
  stat.history.push({ rating, t, ts: log.ts });
  stat.lastRating = rating;
  stat.lastTs = log.ts;
}

const wordsArr = Array.from(wordStats.values());

console.log(`\n=== 1. TỔNG QUAN TẬP DỮ LIỆU ===`);
console.log(`Số lượt review: ${logs.length}`);
console.log(`Số từ vựng duy nhất (Unique Vocabulary): ${wordStats.size}`);
console.log(`Thời gian ghi nhận: từ ${minDate.toISOString()} đến ${maxDate.toISOString()}`);

console.log(`\n=== 2. CHỈ SỐ GHI NHỚ & RATING DISTRIBUTION ===`);
const retTotal = logs.length;
const retGoodEasy = (ratingCounts[3] || 0) + (ratingCounts[4] || 0);
const retHardAgain = (ratingCounts[1] || 0) + (ratingCounts[2] || 0);
console.log(`Rating 1 (Again - Quên): ${ratingCounts[1]} (${(ratingCounts[1]/retTotal*100).toFixed(2)}%)`);
console.log(`Rating 2 (Hard - Khó): ${ratingCounts[2]} (${(ratingCounts[2]/retTotal*100).toFixed(2)}%)`);
console.log(`Rating 3 (Good - Nhớ): ${ratingCounts[3]} (${(ratingCounts[3]/retTotal*100).toFixed(2)}%)`);
console.log(`Rating 4 (Easy - Quá dễ): ${ratingCounts[4]} (${(ratingCounts[4]/retTotal*100).toFixed(2)}%)`);
console.log(`-> Tỷ lệ ghi nhớ thành công (Good + Easy, 3+4): ${(retGoodEasy / retTotal * 100).toFixed(2)}% (${retGoodEasy}/${retTotal})`);
console.log(`-> Tỷ lệ gặp trở ngại (Again + Hard, 1+2): ${(retHardAgain / retTotal * 100).toFixed(2)}% (${retHardAgain}/${retTotal})`);

// Interval distributions
const intervals = logs.map(l => Number(l.t || 0));
intervals.sort((a, b) => a - b);
const medianT = intervals[Math.floor(intervals.length / 2)];
const avgT = (totalInterval / logs.length).toFixed(2);
const maxTAll = Math.max(...intervals);
console.log(`Khoảng cách thời gian (Interval t): Avg = ${avgT} ngày, Median = ${medianT} ngày, Max = ${maxTAll} ngày`);

// Buckets of t
const tBuckets = { '0-1d': 0, '2-3d': 0, '4-7d': 0, '8-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 };
for (const t of intervals) {
  if (t <= 1) tBuckets['0-1d']++;
  else if (t <= 3) tBuckets['2-3d']++;
  else if (t <= 7) tBuckets['4-7d']++;
  else if (t <= 14) tBuckets['8-14d']++;
  else if (t <= 30) tBuckets['15-30d']++;
  else if (t <= 60) tBuckets['31-60d']++;
  else tBuckets['60d+']++;
}
console.log('Phân bố Interval t của các lượt review:', tBuckets);

// Leeches analysis
// Definition of leech: high Again count (rating 1 >= 3, or rating 1 >= 2 and totalReviews <= 4, or failure rate >= 40% with reviews >= 3)
const leeches = wordsArr
  .filter(w => w.ratings[1] >= 2 || (w.ratings[1] + w.ratings[2] >= 3 && w.ratings[1] >= 1))
  .map(w => {
    const failureRate = ((w.ratings[1] + w.ratings[2]) / w.totalReviews * 100).toFixed(1);
    const againRate = (w.ratings[1] / w.totalReviews * 100).toFixed(1);
    return { ...w, failureRate: Number(failureRate), againRate: Number(againRate) };
  })
  .sort((a, b) => b.ratings[1] - a.ratings[1] || b.failureRate - a.failureRate);

console.log(`\n=== 3. LEECH WORDS PHÂN TÍCH ===`);
console.log(`Tổng số từ có dấu hiệu chật vật / Leech: ${leeches.length}`);
console.log('Top 35 từ có số lần bấm "Again (1)" nhiều nhất:');
for (const l of leeches.slice(0, 35)) {
  console.log(`- "${l.word}": Again(1)=${l.ratings[1]}, Hard(2)=${l.ratings[2]}, Good(3)=${l.ratings[3]}, Easy(4)=${l.ratings[4]} | Total: ${l.totalReviews} | MaxT: ${l.maxT}d | AgainRate: ${l.againRate}%`);
}

// Long-term retention: cards with large interval (t >= 14 or t >= 21) with rating 3 or 4
const highStabilityWords = wordsArr
  .filter(w => w.maxT >= 14 && (w.lastRating === 3 || w.lastRating === 4))
  .sort((a, b) => b.maxT - a.maxT);

console.log(`\n=== 4. TỪ VỰNG DUY TRÌ DÀI HẠN (HIGH STABILITY) ===`);
console.log(`Số từ đạt chu kỳ >= 14 ngày & điểm cuối Good/Easy: ${highStabilityWords.length}`);
console.log('Top 30 từ bền vững nhất:');
for (const h of highStabilityWords.slice(0, 30)) {
  console.log(`- "${h.word}": MaxT=${h.maxT}d, Reviews=${h.totalReviews}, Ratings=[Again:${h.ratings[1]}, Hard:${h.ratings[2]}, Good:${h.ratings[3]}, Easy:${h.ratings[4]}]`);
}

// Write out JSONs for next stages
fs.writeFileSync('scratch/unique_words.json', JSON.stringify(wordsArr.map(w => w.word), null, 2));
fs.writeFileSync('scratch/word_stats.json', JSON.stringify(wordsArr, null, 2));
fs.writeFileSync('scratch/leeches.json', JSON.stringify(leeches, null, 2));
fs.writeFileSync('scratch/high_stability.json', JSON.stringify(highStabilityWords, null, 2));
