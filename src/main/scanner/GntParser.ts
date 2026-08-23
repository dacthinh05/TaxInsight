import * as cheerio from 'cheerio';
import { TaxType } from '../../shared/types';
import { GntMoneyParser, MoneyParseResult } from './GntMoneyParser';
import { GntPeriodNormalizer, NormalizedTaxPeriod } from './GntPeriodNormalizer';
import { TaxNdktClassifier } from '../engine/TaxNdktClassifier';

export type GntStatus =
  | 'PAID_SUCCESS'
  | 'FAILED'
  | 'PENDING'
  | 'OTHER'
  | 'UNKNOWN';

export type GntDetailIntegrity =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'MISMATCH'
  | 'UNKNOWN';

export interface GntListRecord {
  ctuId: string;
  transactionRef?: string;
  detailTransactionRef?: string;
  submissionNo?: number;
  gntNo?: string;
  amount: MoneyParseResult;
  currency?: string;
  statusRaw: string;
  statusNormalized: GntStatus;
  bankDocumentNo?: string;
  createdAt?: string;
  sentAt?: string;
  paidAt?: string;
  source?: 'ETAX' | 'OTHER_CHANNEL';
  bankName?: string;
  bankAccount?: string;
  canDownload: boolean;
  raw?: {
    cells: string[];
  };
}

export interface GntAllocation {
  sequence?: number;
  referenceDocumentNo?: string;
  taxPeriodRaw?: string;
  description?: string;
  originalAmount: MoneyParseResult;
  vndAmount: MoneyParseResult;
  chapterCode?: string;
  ndktCode?: string;
  normalizedPeriod?: NormalizedTaxPeriod | null;
  inferredTaxType?: TaxType | 'UNKNOWN';
  evidence: {
    periodSource: 'DETAIL_TABLE' | 'UNKNOWN';
    taxTypeSource: 'NDKT' | 'DESCRIPTION' | 'REFERENCE' | 'UNKNOWN';
  };
}

export interface GntSignature {
  signerName: string;
  signedAt?: string;
}

export interface ParsedGnt {
  id: string; // ctuId
  gntNo: string;
  formNumber?: string; // Mẫu số C1-02/NS
  symbolCode?: string; // Mã hiệu (ví dụ 2620202TSA)
  documentNo?: string; // Số chứng từ ngân hàng
  transactionRef?: string; // Số tham chiếu
  paymentMethod?: string; // Tiền mặt / Chuyển khoản
  currency?: string;
  taxpayerName: string;
  taxpayerId: string;
  address?: string;
  province?: string;
  behalfTaxpayerName?: string;
  behalfAddress?: string;
  debitBank?: string;
  debitAccount?: string;
  treasuryAccountType?: string;
  treasuryAccount?: string;
  treasuryName?: string;
  treasuryProvince?: string;
  collectingBank?: string;
  collectionAgency?: string;
  allocations: GntAllocation[];
  totalVndAmount: MoneyParseResult;
  totalTextVnd?: string;
  detailIntegrity: GntDetailIntegrity;
  signatures: GntSignature[];
  rawHtml?: string;
}

export class GntParser {
  /**
   * Phân tích Danh sách GNT từ bảng HTML (#allResultTableBody)
   * Sử dụng header mapping an toàn thay vì nth-child cố định.
   */
  public static parseList(html: string): GntListRecord[] {
    const results: GntListRecord[] = [];
    if (!html || typeof html !== 'string') return results;

    const $ = cheerio.load(html);
    const tbody = $('#allResultTableBody');
    if (!tbody.length) return results;

    tbody.find('tr').each((_, tr) => {
      const $tr = $(tr);
      const $tds = $tr.find('td');
      if ($tds.length < 8) return;

      const cells: string[] = [];
      $tds.each((_, td) => {
        cells.push($(td).text().trim());
      });

      const sttText = cells[0];
      const stt = parseInt(sttText, 10);
      if (isNaN(stt)) return; // Bỏ qua các dòng thông báo con hoặc dòng rỗng

      const maGiaoDich = cells[1] || undefined;
      const maGiaoDichChiTiet = cells[2] || undefined;
      const lanNop = cells[3] ? parseInt(cells[3], 10) : undefined;

      // Cột 4: Số GNT và ctuId từ thẻ <a>
      const $gntLink = $tds.eq(4).find('a');
      const soGnt = ($gntLink.length ? $gntLink.text() : cells[4]).trim() || undefined;

      let ctuId = '';
      const href = $gntLink.attr('href') || '';
      const matchCtu = href.match(/chiTietCT\((\d+)\)/) || href.match(/downloadGNT\((\d+)\)/);
      if (matchCtu) {
        ctuId = matchCtu[1];
      }

      if (!ctuId) {
        // Tìm trong các nút download/action khác ở các cột sau
        $tr.find('a').each((_, a) => {
          const aHref = $(a).attr('href') || '';
          const m = aHref.match(/(?:chiTietCT|downloadGNT|uploadBke)\((\d+)/);
          if (m && !ctuId) {
            ctuId = m[1];
          }
        });
      }

      if (!ctuId) {
        // Fallback deterministic (không dùng Date.now() — tránh id thay đổi mỗi lần parse)
        ctuId = soGnt || `gnt_${stt}_${maGiaoDich || 'NA'}_${lanNop || 1}_${cells[5] || ''}_${cells[9] || ''}`;
      }

      // Cột 5: Số tiền
      const amount = GntMoneyParser.parse(cells[5]);

      // Cột 6: Loại tiền
      const currency = cells[6] || 'VND';

      // Cột 7: Trạng thái
      const statusRaw = cells[7] || '';
      let statusNormalized: GntStatus = 'UNKNOWN';
      const statusLower = statusRaw.toLowerCase().trim();
      // P0 FIX: Kiểm tra các trạng thái phủ định TRƯỚC trạng thái dương
      // Tránh "không thành công".includes("thành công") = true → sai thành PAID_SUCCESS
      if (
        statusLower.includes('không thành công') ||
        statusLower.includes('lỗi') ||
        statusLower.includes('không chấp nhận') ||
        statusLower.includes('từ chối') ||
        statusLower.includes('thất bại') ||
        statusLower.includes('không hợp lệ') ||
        statusLower.includes('huỷ') ||
        statusLower.includes('hủy')
      ) {
        statusNormalized = 'FAILED';
      } else if (
        statusLower === 'nộp thuế thành công' ||
        statusLower.includes('thành công') ||
        statusLower.startsWith('đã nộp')
      ) {
        statusNormalized = 'PAID_SUCCESS';
      } else if (
        statusLower.includes('chờ') ||
        statusLower.includes('đang xử lý') ||
        statusLower.includes('đang') ||
        statusLower.includes('đã gửi')
      ) {
        statusNormalized = 'PENDING';
      } else if (statusRaw) {
        statusNormalized = 'OTHER';
      }

      // Cột 8: Số chứng từ ngân hàng
      const bankDocumentNo = cells[8] || undefined;

      // Cột 9, 10, 11: Ngày lập, Ngày gửi, Ngày nộp
      const createdAt = cells[9] || undefined;
      const sentAt = cells[10] || undefined;
      const paidAt = cells[11] || undefined;

      // Kênh nộp, Ngân hàng, Số TK
      const paymentChannelText = cells[15] || '';
      const source: 'ETAX' | 'OTHER_CHANNEL' = paymentChannelText.toLowerCase().includes('khác') ? 'OTHER_CHANNEL' : 'ETAX';
      const bankName = cells[16] || undefined;
      const bankAccount = cells[17] || undefined;

      const canDownload = Boolean($tr.find('a[href*="downloadGNT"]').length);

      results.push({
        ctuId,
        transactionRef: maGiaoDich,
        detailTransactionRef: maGiaoDichChiTiet,
        submissionNo: isNaN(lanNop as number) ? undefined : lanNop,
        gntNo: soGnt,
        amount,
        currency,
        statusRaw,
        statusNormalized,
        bankDocumentNo,
        createdAt,
        sentAt,
        paidAt,
        source,
        bankName,
        bankAccount,
        canDownload,
        raw: { cells }
      });
    });

    return results;
  }

  /**
   * Phân tích nội dung chi tiết Mẫu C1-02/NS
   */
  public static parseDetail(html: string, fallbackId = ''): ParsedGnt {
    const $ = cheerio.load(html);

    // Mã hiệu & Số chứng từ
    let symbolCode = '';
    const mSymbol = html.match(/Mã\s*hiệu:\s*[\s\S]*?<span>([^<]+)<\/span>/i);
    if (mSymbol) symbolCode = mSymbol[1].trim();

    let documentNo = '';
    const mDocNo = html.match(/Số:\s*[\s\S]*?<span>([^<]+)<\/span>/i);
    if (mDocNo) documentNo = mDocNo[1].trim();

    let transactionRef = '';
    const mRef = html.match(/Số\s*tham\s*chiếu:\s*[\s\S]*?(\d{10,})/i);
    if (mRef) transactionRef = mRef[1].trim();

    // Thông tin NNT & MST
    let taxpayerName = '';
    const mNnt = html.match(/Người\s*nộp\s*thuế:\s*[\s\S]*?text-transform:uppercase;\">([^<]+)<\/span>/i);
    if (mNnt) taxpayerName = mNnt[1].trim();

    let taxpayerId = '';
    const mMst = html.match(/Mã\s*số\s*thuế:\s*[\s\S]*?<span[^>]*>(\d{10,14})<\/span>/i);
    if (mMst) taxpayerId = mMst[1].trim();

    let address = '';
    const mAddr = html.match(/Địa\s*chỉ:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mAddr) address = mAddr[1].trim();

    let province = '';
    const mProv = html.match(/Tỉnh,\s*TP:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mProv) province = mProv[1].trim();

    // Ngân hàng trích TK
    let debitBank = '';
    const mBank = html.match(/Đề\s*nghị\s*NH\/\s*KBNN:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mBank) debitBank = mBank[1].trim();

    let debitAccount = $('#so_tk_nhang').text().trim() || undefined;

    // Kho bạc & Cơ quan quản lý thu
    let treasuryName = '';
    const mTreasury = html.match(/Vào\s*tài\s*Khoản\s*KBNN:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mTreasury) treasuryName = mTreasury[1].trim();

    let collectingBank = '';
    const mUnt = html.match(/Mở\s*tại\s*NH\s*ủy\s*nhiệm\s*thu:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mUnt) collectingBank = mUnt[1].trim();

    let collectionAgency = '';
    const mCq = html.match(/Cơ\s*quan\s*quản\s*lý\s*thu:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (mCq) collectionAgency = mCq[1].trim();

    // Bảng chi tiết các khoản nộp (#chungtu_ctiet)
    const allocations: GntAllocation[] = [];
    let sumAllocationsVnd = 0n;
    let hasInvalidRow = false;   // FIX 2: track dòng có amount INVALID
    const seenRowSignatures = new Set<string>(); // FIX 2: detect duplicate rows

    $('#chungtu_ctiet tbody tr').each((_, tr) => {
      const $tds = $(tr).find('td');
      if ($tds.length >= 7) {
        const sttText = $tds.eq(0).text().trim();
        const sequence = parseInt(sttText, 10);
        if (!isNaN(sequence)) {
          const referenceDocumentNo = $tds.eq(1).text().trim() || undefined;
          const taxPeriodRaw = $tds.eq(2).text().trim() || undefined;
          const description = $tds.eq(3).text().trim() || undefined;
          const originalAmount = GntMoneyParser.parse($tds.eq(4).text().trim());
          const vndAmount = GntMoneyParser.parse($tds.eq(5).text().trim());
          const chapterCode = $tds.eq(6).text().trim() || undefined;
          const ndktCode = $tds.eq(7).text().trim() || undefined;

          // FIX 2: Dòng có amount INVALID phá vỡ tính toàn vẹn
          if (vndAmount.status === 'INVALID') {
            hasInvalidRow = true;
          }

          if (vndAmount.status === 'VALID') {
            sumAllocationsVnd += vndAmount.value;
          }

          // FIX 2: Detect duplicate rows bằng signature (period+ndkt+amount)
          const rowSig = `${taxPeriodRaw}|${ndktCode}|${chapterCode}|${vndAmount.raw}|${referenceDocumentNo}`;
          if (seenRowSignatures.has(rowSig)) {
            // Duplicate row — đánh dấu invalid nhưng vẫn record để debug
            hasInvalidRow = true;
            console.warn(`[GntParser] Duplicate allocation row detected: ${rowSig}`);
          } else {
            seenRowSignatures.add(rowSig);
          }

          // Chuẩn hóa kỳ thuế & phân loại sắc thuế
          const normalizedPeriod = GntPeriodNormalizer.normalize(taxPeriodRaw);
          const classification = TaxNdktClassifier.classify(ndktCode, description);

          allocations.push({
            sequence,
            referenceDocumentNo,
            taxPeriodRaw,
            description,
            originalAmount,
            vndAmount,
            chapterCode,
            ndktCode,
            normalizedPeriod,
            inferredTaxType: classification.taxType,
            evidence: {
              periodSource: taxPeriodRaw ? 'DETAIL_TABLE' : 'UNKNOWN',
              taxTypeSource: classification.confidence === 'EXACT_CODE' ? 'NDKT' : classification.confidence === 'DESCRIPTION_MATCH' ? 'DESCRIPTION' : 'UNKNOWN'
            }
          });
        }
      }
    });

    // Tổng tiền VND trên GNT
    const totalRawVnd = $('#sum').text().trim();
    const totalVndAmount = GntMoneyParser.parse(totalRawVnd || (allocations.length > 0 ? allocations[0].vndAmount.raw : '0'));
    const totalTextVnd = $('#sotienbangchu_VND').text().trim() || undefined;

    // FIX 2: Kiểm tra tính toàn vẹn nghiêm ngặt
    // VERIFIED chỉ khi: tất cả dòng valid + không duplicate + sum khớp header
    let detailIntegrity: GntDetailIntegrity = 'UNKNOWN';
    if (totalVndAmount.status === 'VALID' && allocations.length > 0) {
      if (hasInvalidRow) {
        // Có dòng parse lỗi hoặc duplicate → không thể VERIFIED
        detailIntegrity = 'PARTIAL';
      } else if (sumAllocationsVnd === totalVndAmount.value) {
        detailIntegrity = 'VERIFIED';
      } else if (sumAllocationsVnd > 0n) {
        detailIntegrity = 'MISMATCH';
      } else {
        detailIntegrity = 'PARTIAL';
      }
    } else if (allocations.length > 0) {
      detailIntegrity = 'PARTIAL';
    }

    // Chữ ký điện tử (Signatures)
    const signatures: GntSignature[] = [];
    $('li table').each((_, table) => {
      const text = $(table).text();
      const signerMatch = text.match(/Người\s*ký\s*:\s*([^]+?)(?:Ngày\s*ký|$)/i);
      const dateMatch = text.match(/Ngày\s*ký\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s*\d{1,2}:\d{1,2}:\d{1,2})/i);
      if (signerMatch) {
        signatures.push({
          signerName: signerMatch[1].trim(),
          signedAt: dateMatch ? dateMatch[1].trim() : undefined
        });
      }
    });

    return {
      id: fallbackId || documentNo || transactionRef || `gnt_${Date.now()}`,
      gntNo: documentNo || fallbackId,
      formNumber: 'C1-02/NS',
      symbolCode,
      documentNo,
      transactionRef,
      paymentMethod: 'CHUYEN_KHOAN',
      currency: 'VND',
      taxpayerName: taxpayerName || 'Người nộp thuế',
      taxpayerId: taxpayerId || '',
      address,
      province,
      debitBank,
      debitAccount,
      treasuryAccount: '7111',
      treasuryName,
      treasuryProvince: province,
      collectingBank,
      collectionAgency,
      allocations,
      totalVndAmount,
      totalTextVnd,
      detailIntegrity,
      signatures,
      rawHtml: html
    };
  }
}
