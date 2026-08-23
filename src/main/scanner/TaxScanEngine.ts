import { EventEmitter } from 'events';
import {
  checkMissingPeriods,
  generateDailyRanges,
  generateMonthRanges,
  generateQuarterRanges,
  generateSubDecadeRanges,
  generateSubMonthRanges,
  generateYearRange
} from '../../shared/dateUtils';
import {
  DateRange,
  MissingPeriodCheck,
  ScanProgressState,
  TaxFiling,
  TaxType
} from '../../shared/types';
import { CaptchaManager } from '../portal/CaptchaManager';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { PaginationResolver } from './PaginationResolver';
import { TaxFilingParser } from './TaxFilingParser';

export class TaxScanEngine extends EventEmitter {
  private client: TaxPortalClient;
  private captchaManager: CaptchaManager;
  private paginationResolver: PaginationResolver;
  private isScanning = false;
  private isCancelled = false;
  private scanToken = 0;
  private allFilings: TaxFiling[] = [];

  constructor(client: TaxPortalClient, captchaManager: CaptchaManager) {
    super();
    this.client = client;
    this.captchaManager = captchaManager;
    this.paginationResolver = new PaginationResolver(client, captchaManager);

    // Chuyển tiếp sự kiện CAPTCHA từ CaptchaManager sang UI
    this.captchaManager.on('challenge', challenge => {
      this.emit('captcha_required', challenge);
    });
  }

  public getFilings(): TaxFiling[] {
    return [...this.allFilings];
  }

  public clearFilings() {
    this.allFilings = [];
  }

  public cancelScan() {
    this.isCancelled = true;
    this.captchaManager.cancel('Tác vụ quét đã bị hủy bởi người dùng');
  }

  /**
   * Kiểm tra scan có còn "được phép chạy tiếp" hay không.
   * Dùng generation token để chống race cancel/restart:
   * khi user hủy rồi quét lại ngay, token của vòng lặp cũ sẽ khác token hiện tại
   * nên vòng lặp cũ tự thoát dù cờ isCancelled đã bị đợt quét mới reset.
   */
  private isActiveScan(token: number): boolean {
    return token === this.scanToken && !this.isCancelled;
  }

  public submitCaptcha(captcha: string) {
    this.captchaManager.submitCaptcha(captcha);
  }

  /**
   * Quét toàn bộ năm theo nguyên tắc:
   * Pagination First trước -> Tự động giải CAPTCHA từng trang -> Tự động phân rã Quý -> Tháng -> 10 ngày khi chạm trần.
   */
  public async scanYear(
    year: number,
    selectedTaxType: TaxType | 'ALL' = 'ALL',
    options: {
      maNghiepVu?: string;
      maTTHC?: string;
      maToKhai?: string;
      scope?: string;
      mstUyQuyen?: string;
      limitToToday?: boolean;
      customRange?: DateRange;
    } = {}
  ): Promise<{
    filings: TaxFiling[];
    missingVatCheck: MissingPeriodCheck;
    missingPitCheck: MissingPeriodCheck;
  }> {
    if (this.isScanning) {
      throw new Error('Đang có một tiến trình quét khác đang chạy');
    }

    this.isScanning = true;
    this.isCancelled = false;
    const myToken = ++this.scanToken;
    this.allFilings = []; // Luôn reset cho đợt quét mới để không lẫn dữ liệu cũ

    try {
      // ─── 1. NẾU USER CHỌN KỲ CỤ THỂ (1 QUÝ HOẶC 1 THÁNG) ─────────────
      const isSpecificPartialRange = options.customRange && options.customRange.level !== 'YEAR';

      if (isSpecificPartialRange) {
        const targetRange = options.customRange!;
        this.emitProgress({
          currentRange: targetRange,
          completedRanges: 0,
          totalRanges: 1,
          foundFilingsCount: 0,
          level: targetRange.level || 'MONTH',
          status: 'SCANNING'
        });

        const captcha = await this.captchaManager.requestCaptcha('SEARCH', targetRange);
        const pageResult = await this.client.searchFilings(targetRange, captcha, {
          ...options,
          maTTHC: options.maTTHC || undefined
        });

        const resolution = await this.paginationResolver.resolveAllPagesForRange(
          targetRange,
          captcha,
          pageResult.filings,
          pageResult.hasMorePages || false,
          options
        );

        this.allFilings = resolution.filings;

        let resultFilings = this.allFilings;
        if (selectedTaxType !== 'ALL') {
          resultFilings = this.allFilings.filter(f => f.taxType === selectedTaxType);
        }

        // Quét partial range (1 Quý/Tháng) → không so sánh với kỳ toàn năm, truyền isScanComplete=false
        return {
          filings: resultFilings,
          missingVatCheck: checkMissingPeriods(this.allFilings, year, 'VAT', false),
          missingPitCheck: checkMissingPeriods(this.allFilings, year, 'PIT', false)
        };
      }

      this.emitProgress({
        currentRange: null,
        completedRanges: 0,
        totalRanges: 1,
        foundFilingsCount: 0,
        level: options.customRange?.level || 'YEAR',
        status: 'SCANNING'
      });

      // ─── 2. DANH SÁCH CÁC NĂM CẦN QUÉT (ĐƠN NĂM HOẶC ĐA NĂM 3-5 NĂM) ───
      const currentYear = new Date().getFullYear();
      const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);
      const allYearsToScan: number[] = [];

      if (options.customRange?.level === 'MULTI_YEAR') {
        const startY = parseInt(options.customRange.fromDate.split('/')[2], 10) || (currentYear - 2);
        const endY = parseInt(options.customRange.toDate.split('/')[2], 10) || currentYear;
        for (let y = startY; y <= endY; y++) {
          allYearsToScan.push(y);
        }
      } else {
        allYearsToScan.push(year);
      }

      // Xây dựng danh sách tất cả các khoảng Quý/Kỳ cần quét
      const allScanRanges: { range: DateRange; yearOwner: number }[] = [];

      for (const y of allYearsToScan) {
        const qRanges = generateQuarterRanges(y);
        const targetQ = (options.limitToToday && y === currentYear)
          ? qRanges.slice(0, currentQuarter)
          : qRanges;

        for (const qr of targetQ) {
          allScanRanges.push({ range: qr, yearOwner: y });
        }

        // Với năm cũ (y < currentYear), nếu không phải chế độ đa năm (vì đa năm sẽ quét năm tiếp theo ngay sau đó),
        // bổ sung thêm Quý 1 năm sau để đón bắt trọn tờ khai Quyết toán TNDN (03/TNDN), QTT TNCN và T12 nộp vào T01-T03 năm sau
        if (y < currentYear && options.customRange?.level !== 'MULTI_YEAR') {
          allScanRanges.push({
            range: {
              fromDate: `01/01/${y + 1}`,
              toDate: `31/03/${y + 1}`,
              label: `QTT Năm ${y} (Nộp T01-T03/${y + 1})`,
              level: 'QUARTER'
            },
            yearOwner: y
          });
        }
      }

      const scanOptions = {
        ...options,
        maTTHC: options.maTTHC || undefined
      };

      for (let i = 0; i < allScanRanges.length; i++) {
        if (!this.isActiveScan(myToken)) break;
        const { range: qRange, yearOwner: rangeYear } = allScanRanges[i];

        this.emitProgress({
          currentRange: qRange,
          completedRanges: i,
          totalRanges: allScanRanges.length,
          foundFilingsCount: this.allFilings.length,
          level: 'QUARTER',
          status: 'SCANNING'
        });

        let needSplitToMonths = false;
        try {
          const { captcha: qCaptcha, firstPage: qFirstPage } = await this.searchWithRetry(qRange, scanOptions, myToken);

          const qResolution = await this.paginationResolver.resolveAllPagesForRange(
            qRange,
            qCaptcha,
            qFirstPage.filings,
            qFirstPage.hasMorePages || false,
            scanOptions,
            (page, count) => {
              this.emit('log', {
                type: 'INFO',
                action: `Đã duyệt trang ${page} của ${qRange.label} (lấy thêm ${count} hồ sơ)`
              });
            }
          );

          this.allFilings = TaxFilingParser.deduplicateFilings(this.allFilings, qResolution.filings);

          if (qResolution.needSplitRange || qFirstPage.filings.length >= 20 || !qResolution.isFullyRetrieved) {
            needSplitToMonths = true;
          }
        } catch {
          needSplitToMonths = true;
        }

        // Nếu quý bị đầy (>= 20 bản ghi) → Tự động quét chi tiết 3 tháng của quý đó
        if (needSplitToMonths && this.isActiveScan(myToken)) {
          const startMonth = parseInt(qRange.fromDate.split('/')[1], 10) || 1;
          const endMonth = parseInt(qRange.toDate.split('/')[1], 10) || 12;
          // Lấy năm trực tiếp từ khoảng ngày đang quét (khác yearOwner với range QTT năm trước
          // vốn trải từ T01-T03 của năm sau)
          const splitYear = parseInt(qRange.fromDate.split('/')[2], 10) || rangeYear;
          const allMonths = generateMonthRanges(splitYear);
          const quarterMonths = allMonths.filter(m => {
            const mNum = parseInt(m.fromDate.split('/')[1], 10);
            return mNum >= startMonth && mNum <= endMonth;
          });

          for (const mRange of quarterMonths) {
            if (!this.isActiveScan(myToken)) break;
            await new Promise(r => setTimeout(r, 450));
            let needSplitTo10Days = false;
            try {
              const { captcha: mCaptcha, firstPage: mFirstPage } = await this.searchWithRetry(mRange, scanOptions, myToken);
              const mResolution = await this.paginationResolver.resolveAllPagesForRange(
                mRange,
                mCaptcha,
                mFirstPage.filings,
                mFirstPage.hasMorePages || false,
                scanOptions
              );
              this.allFilings = TaxFilingParser.deduplicateFilings(this.allFilings, mResolution.filings);

              if (mResolution.needSplitRange || mFirstPage.filings.length >= 20) {
                needSplitTo10Days = true;
              }
            } catch (mErr: any) {
              needSplitTo10Days = true;
              this.emit('log', {
                type: 'WARNING',
                action: `Lỗi quét khoảng ${mRange.label}: ${mErr.message}`
              });
            }

            // Nếu 1 tháng có >= 20 bản ghi → Tự động quét sâu theo 3 khoảng 10 ngày
            if (needSplitTo10Days && this.isActiveScan(myToken)) {
              const subRanges = generateSubMonthRanges(mRange);
              for (const subRange of subRanges) {
                if (!this.isActiveScan(myToken)) break;
                await new Promise(r => setTimeout(r, 450));
                let needSplitTo5Days = false;
                try {
                  const { captcha: subCaptcha, firstPage: subFirstPage } = await this.searchWithRetry(subRange, scanOptions, myToken);
                  const subResolution = await this.paginationResolver.resolveAllPagesForRange(
                    subRange,
                    subCaptcha,
                    subFirstPage.filings,
                    subFirstPage.hasMorePages || false,
                    scanOptions
                  );
                  this.allFilings = TaxFilingParser.deduplicateFilings(this.allFilings, subResolution.filings);
                  if (subResolution.needSplitRange || subFirstPage.filings.length >= 20) {
                    needSplitTo5Days = true;
                  }
                } catch {
                  needSplitTo5Days = true;
                }

                // Nếu 1 khoảng 10 ngày vẫn bị tràn (>= 20 bản ghi) → Phân rã tiếp thành 5 ngày & từng ngày
                if (needSplitTo5Days && this.isActiveScan(myToken)) {
                  const fiveDayRanges = generateSubDecadeRanges(subRange);
                  for (const fiveDayRange of fiveDayRanges) {
                    if (!this.isActiveScan(myToken)) break;
                    await new Promise(r => setTimeout(r, 450));
                    let needDailySplit = false;
                    try {
                      const { captcha: fCaptcha, firstPage: fFirstPage } = await this.searchWithRetry(fiveDayRange, scanOptions, myToken);
                      const fResolution = await this.paginationResolver.resolveAllPagesForRange(
                        fiveDayRange,
                        fCaptcha,
                        fFirstPage.filings,
                        fFirstPage.hasMorePages || false,
                        scanOptions
                      );
                      this.allFilings = TaxFilingParser.deduplicateFilings(this.allFilings, fResolution.filings);
                      if (fResolution.needSplitRange || fFirstPage.filings.length >= 20) {
                        needDailySplit = true;
                      }
                    } catch {
                      needDailySplit = true;
                    }

                    // Nếu 5 ngày vẫn >= 20 bản ghi → Phân rã tới từng ngày đơn lẻ (Daily level)
                    if (needDailySplit && this.isActiveScan(myToken)) {
                      const dailyRanges = generateDailyRanges(fiveDayRange);
                      for (const dailyRange of dailyRanges) {
                        if (!this.isActiveScan(myToken)) break;
                        await new Promise(r => setTimeout(r, 450));
                        try {
                          const { captcha: dCaptcha, firstPage: dFirstPage } = await this.searchWithRetry(dailyRange, scanOptions, myToken);
                          const dResolution = await this.paginationResolver.resolveAllPagesForRange(
                            dailyRange,
                            dCaptcha,
                            dFirstPage.filings,
                            dFirstPage.hasMorePages || false,
                            scanOptions
                          );
                          this.allFilings = TaxFilingParser.deduplicateFilings(this.allFilings, dResolution.filings);
                        } catch {}
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      const missingVatCheck = checkMissingPeriods(this.allFilings, year, 'VAT');
      const missingPitCheck = checkMissingPeriods(this.allFilings, year, 'PIT');

      this.emitProgress({
        currentRange: null,
        completedRanges: 1,
        totalRanges: 1,
        foundFilingsCount: this.allFilings.length,
        level: 'YEAR',
        status: 'COMPLETED'
      });

      return {
        filings: this.allFilings,
        missingVatCheck,
        missingPitCheck
      };
    } finally {
      this.isScanning = false;
    }
  }

  private async searchWithRetry(
    range: DateRange,
    scanOptions: any,
    scanToken?: number,
    maxRetries = 3
  ): Promise<{ captcha: string; firstPage: any }> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const cancelled = scanToken !== undefined ? !this.isActiveScan(scanToken) : this.isCancelled;
      if (cancelled) throw new Error('Quá trình quét đã bị hủy');
      try {
        const captcha = await this.captchaManager.requestCaptcha('SEARCH', range);
        const firstPage = await this.client.searchFilings(range, captcha, scanOptions);
        return { captcha, firstPage };
      } catch (err: any) {
        lastErr = err;
        if (err.code === 'CAPTCHA_INVALID') {
          console.log(`[TaxScanEngine] CAPTCHA chưa đúng ở lần thử ${attempt}, tự động thử lại với CAPTCHA mới...`);
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private emitProgress(state: ScanProgressState) {
    this.emit('progress', state);
  }
}
