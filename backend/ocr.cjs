// Runs locally with bundled English language data; never sends documents out.
const { createWorker } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');
(async () => {
  const worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const images = JSON.parse(input);
    const pages = [];
    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image, 'base64'));
      pages.push({ text: data.text, confidence: data.confidence });
    }
    process.stdout.write(JSON.stringify(pages));
  } finally { await worker.terminate(); }
})().catch(() => { process.stderr.write('Local OCR failed.'); process.exit(1); });
