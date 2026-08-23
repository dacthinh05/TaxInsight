/**
 * Verify offline: chạy GntParser.parseList trên file HTML THẬT dump từ server
 * Usage: npx vite-node scripts/verify-parser-on-dump.mts <path-to-html>
 */
import fs from 'fs';
import { GntParser } from '../src/main/scanner/GntParser';
import { GdtResponseClassifier } from '../src/main/portal/GdtResponseClassifier';

const file = process.argv[2] || 'C:/Users/dacth/AppData/Local/Temp/gnt_nav_hop_99_1787454202336.html';
const html = fs.readFileSync(file, 'utf-8');

const kind = GdtResponseClassifier.classify(html);
console.log('Classifier:', kind);

const records = GntParser.parseList(html);
console.log('Số bản ghi parse được:', records.length);
for (const r of records) {
  console.log(JSON.stringify({
    ctuId: r.ctuId,
    transactionRef: r.transactionRef,
    gntNo: r.gntNo,
    amount: r.amount.value.toString(),
    statusRaw: r.statusRaw,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
    bankName: (r.bankName || '').slice(0, 40),
    bankAccount: r.bankAccount,
    canDownload: r.canDownload
  }));
}
