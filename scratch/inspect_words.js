import fs from 'fs';

const words = JSON.parse(fs.readFileSync('scratch/unique_words.json', 'utf8'));
console.log('Total words:', words.length);

for (let i = 0; i < words.length; i += 50) {
  console.log(`\n--- Words ${i} to ${Math.min(i + 49, words.length - 1)} ---`);
  console.log(words.slice(i, i + 50).join(', '));
}
