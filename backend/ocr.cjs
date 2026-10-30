// Runs locally with bundled English language data; never sends documents out.
const { createWorker } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');
(async () => {
  const worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
  try {
    const pages = [];
    for (const path of process.argv.slice(2)) {
      const { data } = await worker.recognize(path);
      pages.push({ text: data.text, confidence: data.confidence });
    }
    process.stdout.write(JSON.stringify(pages));
  } finally { await worker.terminate(); }
})().catch(() => { process.stderr.write('Local OCR failed.'); process.exit(1); });
