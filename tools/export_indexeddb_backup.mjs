import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 1. Get targets from Chrome debugging port 9222
async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const page = targets.find(t => t.url && (t.url.includes('web.app') || t.url.includes('localhost'))) || targets.find(t => t.type === 'page');
          if (page) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('No matching page found on Chrome 9222'));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Simple CDP client via WebSocket
async function dumpData() {
  const wsUrl = await getWsUrl();
  console.log('Connecting to Chrome CDP at:', wsUrl);
  
  const WebSocket = (await import('node:http')).default; // check if WebSocket global or ws package
  let ws;
  if (typeof globalThis.WebSocket !== 'undefined') {
    ws = new globalThis.WebSocket(wsUrl);
  } else {
    // Node 22+ has globalThis.WebSocket
    ws = new globalThis.WebSocket(wsUrl);
  }

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  console.log('Connected to CDP! Extracting IndexedDB data...');

  const script = `
    (async () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('celestial-vocab-idb', 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['vocabulary', 'settings'], 'readonly');
          const vocabReq = tx.objectStore('vocabulary').getAll();
          const settingsReq = tx.objectStore('settings').getAll();
          tx.oncomplete = () => {
            resolve({
              vocab: vocabReq.result || [],
              settings: settingsReq.result || []
            });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    })()
  `;

  let msgId = 1;
  const evalMsg = {
    id: msgId,
    method: 'Runtime.evaluate',
    params: {
      expression: script,
      awaitPromise: true,
      returnByValue: true
    }
  };

  const response = await new Promise((resolve) => {
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === msgId) resolve(msg);
    };
    ws.send(JSON.stringify(evalMsg));
  });

  ws.close();

  if (response.result && response.result.result && response.result.result.value) {
    const { vocab, settings } = response.result.result.value;
    console.log(`Retrieved ${vocab.length} vocabulary words and ${settings.length} settings records.`);

    const backupDir = path.resolve('backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Save JSON backup
    const jsonPath = path.join(backupDir, 'celestial_vocab_3053_words.json');
    fs.writeFileSync(jsonPath, JSON.stringify(vocab, null, 2), 'utf8');
    console.log(`Saved JSON backup to: ${jsonPath} (${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB)`);

    const settingsPath = path.join(backupDir, 'celestial_settings_backup.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`Saved settings backup to: ${settingsPath}`);

    // Generate TSV backup
    // Standard celestial TSV columns:
    // english, vietnamese, wordType, phonetic, example, srsStatus, srsInterval, srsDueDate, difficulty, stability, reps, lapses, tags
    const headers = ['english', 'vietnamese', 'wordType', 'phonetic', 'example', 'srsStatus', 'srsInterval', 'srsDueDate', 'difficulty', 'stability', 'reps', 'lapses', 'tags'];
    const tsvLines = [headers.join('\t')];

    for (const card of vocab) {
      const line = headers.map(h => {
        let val = card[h] ?? '';
        if (Array.isArray(val)) val = val.join(',');
        return String(val).replace(/[\t\r\n]+/g, ' ');
      }).join('\t');
      tsvLines.push(line);
    }

    const tsvPath = path.join(backupDir, 'celestial_vocab_3053_words.tsv');
    fs.writeFileSync(tsvPath, tsvLines.join('\n'), 'utf8');
    console.log(`Saved TSV backup to: ${tsvPath} (${(fs.statSync(tsvPath).size / 1024).toFixed(1)} KB)`);

    return { vocabCount: vocab.length, settingsCount: settings.length, jsonPath, tsvPath };
  } else {
    throw new Error('Failed to evaluate script in page: ' + JSON.stringify(response));
  }
}

dumpData().then(res => {
  console.log('SUCCESS: Full IndexedDB data backup complete!', res);
  process.exit(0);
}).catch(err => {
  console.error('ERROR during data backup:', err);
  process.exit(1);
});
