/**
 * BACKTEST ĐỘ CHÍNH XÁC CAPTCHA - chay offline tren bo anh co nhan
 *
 * Cach chay:
 *   npx vite-node scripts/captcha-backtest.mts <thu-muc-chua-anh>
 *
 * Quy uoc dat ten file: nhan (label) nam o token CUOI cung truoc duoi file,
 * phan cach bang '_' hoac '-'. Vi du:
 *   fdzc6.png | cap_fdzc6.png | sample-01-fdzc6.png  ->  label = "fdzc6"
 *
 * Ket qua: bang so sanh tung mau (nhan vs OCR) + tong ket accuracy,
 * kem thoi gian giai trung binh va ly do chap nhan/tu choi.
 */
import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

interface SampleResult {
  file: string;
  label: string;
  ocr: string;
  ok: boolean;
  confidence: number;
  reason: string;
  votes: { text: string; source: string; conf: number }[];
  ms: number;
}

function extractLabel(basename: string): string {
  const stem = basename.replace(/\.(png|jpe?g|bmp)$/i, '');
  const token = stem.split(/[_\-]/).pop() || '';
  return token.toLowerCase();
}

async function main() {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder)) {
    console.error('Dung cach dung: npx vite-node scripts/captcha-backtest.mts <thu-muc-anh>');
    console.error('Ten file phai chua nhan dung: vi du fdzc6.png hoac cap_01_fdzc6.png');
    process.exit(1);
  }

  const files = fs
    .readdirSync(folder)
    .filter(f => /\.(png|jpe?g|bmp)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error('Khong tim thay anh nao trong thu muc:', folder);
    process.exit(1);
  }

  console.log(`\n=== BACKTEST CAPTCHA: ${files.length} mau tu "${folder}" ===\n`);
  const results: SampleResult[] = [];

  for (const file of files) {
    const label = extractLabel(file);
    const buffer = fs.readFileSync(path.join(folder, file));
    const base64 = buffer.toString('base64');
    const t0 = Date.now();
    const result = await CaptchaSolver.solveDetailed(base64);
    const ms = Date.now() - t0;

    const sampleVotes = result.candidates.map(c => ({ text: c.text, source: c.source, conf: Math.round(c.confidence) }));
    results.push({
      file,
      label,
      ocr: result.text || '(rejected)',
      ok: result.text === label,
      confidence: result.confidence,
      reason: result.reason,
      votes: sampleVotes,
      ms
    });

    const mark = result.text === label ? 'OK ' : 'FAIL';
    console.log(
      `[${mark}] ${file.padEnd(24)} label=${label.padEnd(7)} ocr=${(result.text || '(rejected)').padEnd(9)} conf=${String(result.confidence).padEnd(6)} ${ms}ms ${result.reason}`
    );
    for (const v of sampleVotes) {
      console.log(`        - ${v.source.padEnd(22)} conf=${String(v.conf).padStart(3)}  ${v.text}`);
    }
  }

  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const rejected = results.filter(r => r.ocr === '(rejected)').length;
  const wrongSubmitted = results.filter(r => !r.ok && r.ocr !== '(rejected)').length;
  const avgMs = Math.round(results.reduce((a, r) => a + r.ms, 0) / total);

  console.log('\n=== TONG KET ===');
  console.log(`Tong so mau          : ${total}`);
  console.log(`Dung                 : ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Tu choi (yeu evidence): ${rejected} -> se hien modal nhap tay`);
  console.log(`SAI ma van submit    : ${wrongSubmitted}  <-- chi so quan trong nhat, can = 0`);
  console.log(`Thoi gian TB/mau     : ${avgMs}ms`);

  await CaptchaSolver.terminate();
  process.exit(0);
}

main().catch(err => {
  console.error('Backtest that bai:', err);
  process.exit(1);
});
