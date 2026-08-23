import AdmZip from 'adm-zip';
import fs from 'fs';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { TaxFiling } from '../../shared/types';
import {
  normalizeVatPeriod,
  parseSubmissionTimestamp,
  resolvePeriodSupplementalSequences
} from '../../shared/dateUtils';
import {
  VatAnalyticsSummary,
  VatChainWarning,
  VatDeclarationSnapshot,
  VatPeriodGroup,
  VatVersionDelta
} from '../../shared/vatAnalyticsTypes';
import { VatXmlParser } from './VatXmlParser';
import { ParsedSnapshotStore } from '../persistence/ParsedSnapshotStore';

export class VatAnalyticsEngine {
  private client: TaxPortalClient;
  private memoryCache = new Map<string, VatDeclarationSnapshot>();
  private isCancelled = false;
  private baseDir = '';

  constructor(client: TaxPortalClient, baseDir = '') {
    this.client = client;
    this.baseDir = baseDir;
  }

  public setBaseDir(baseDir: string) {
    this.baseDir = baseDir;
  }

  public cancel() {
    this.isCancelled = true;
  }

  /**
   * Phân tích toàn diện danh sách hồ sơ GTGT với bộ tăng tốc Local-First & Snapshot Cache
   */
  public async analyzeVatFilings(
    filings: TaxFiling[],
    taxpayerId: string,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<VatAnalyticsSummary> {
    this.isCancelled = false;

    // Lọc các hồ sơ thuộc nhóm GTGT (VAT) và phân giải chuỗi bổ sung chuẩn xác
    const rawVatFilings = filings.filter(
      f => f.taxType === 'VAT' || f.declarationCode === '01/GTGT' || f.title.toLowerCase().includes('gtgt')
    );
    const vatFilings = resolvePeriodSupplementalSequences(rawVatFilings);
    const total = vatFilings.length;
    const snapshots: VatDeclarationSnapshot[] = [];

    // Tăng Concurrency lên 5 luồng tải song song
    const concurrency = 5;
    let completedCount = 0;

    for (let i = 0; i < total; i += concurrency) {
      if (this.isCancelled) break;
      const batch = vatFilings.slice(i, i + concurrency);

      const batchPromises = batch.map(async filing => {
        if (this.isCancelled) return null;

        const cacheKey = `${taxpayerId}_${filing.id}`;

        // 1. RAM Memory Cache (0ms)
        if (this.memoryCache.has(cacheKey)) {
          const mem = this.memoryCache.get(cacheKey)!;
          if (mem.xmlAvailable) return mem;
        }

        // 2. Disk Snapshot Cache Store (0.1ms - Chỉ lấy nếu đã có XML đầy đủ)
        if (this.baseDir) {
          const diskSnap = ParsedSnapshotStore.getSnapshot<VatDeclarationSnapshot>(
            this.baseDir,
            taxpayerId,
            filing.id
          );
          if (diskSnap && diskSnap.xmlAvailable) {
            this.memoryCache.set(cacheKey, diskSnap);
            return diskSnap;
          }
        }

        let snapshot: VatDeclarationSnapshot | null = null;

        // 3. Đọc từ file XML đã tải sẵn trong máy (1ms)
        if (filing.downloadedFiles?.xml && fs.existsSync(filing.downloadedFiles.xml)) {
          try {
            const xml = fs.readFileSync(filing.downloadedFiles.xml, 'utf-8');
            snapshot = VatXmlParser.parseVatXml(xml, filing, taxpayerId);
          } catch {}
        }

        // 4. Nếu chưa có XML, tải trực tuyến vào bộ nhớ RAM
        if (!snapshot && filing.downloadAvailable) {
          try {
            const res = await this.client.downloadHoSo(filing.id, undefined, {
              isThueDienTu: filing.isThueDienTu,
              loaiTraCuu: filing.loaiTraCuu
            });

            if (res.content) {
              const zip = new AdmZip(Buffer.from(res.content, 'base64'));
              for (const entry of zip.getEntries()) {
                if (entry.entryName.toLowerCase().endsWith('.xml')) {
                  const xml = entry.getData().toString('utf-8');
                  snapshot = VatXmlParser.parseVatXml(xml, filing, taxpayerId);
                  break;
                }
              }
            }
          } catch {}
        }

        // 5. Fallback metadata snapshot (khi không tải được XML)
        if (!snapshot) {
          const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
          const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
          snapshot = {
            taxpayerId,
            submissionId: filing.id,
            formCode: filing.declarationCode || '01/GTGT',
            period: {
              type: norm.type === 'MONTH' ? 'MONTH' : norm.type === 'QUARTER' ? 'QUARTER' : 'YEAR',
              value: norm.label,
              normalizedKey: norm.key
            },
            declarationType: filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL',
            supplementalNo: filing.supplementalNo || 0,
            sequenceSource: 'API',
            submittedAt: filing.submittedAt,
            status: filing.status || 'Đã nộp',
            ct22_thueDauVaoKyTruoc: 0n,
            ct23_giaTriMuaVao: 0n,
            ct24_thueMuaVao: 0n,
            ct25_thueKhauTruKyNay: 0n,
            ct34_doanhThuBanRa: 0n,
            ct35_thueBanRa: 0n,
            ct37_dChinhGiamThueKTru: 0n,
            ct38_dChinhTangThueKTru: 0n,
            ct40_thuePhaiNop: 0n,
            ct42_thueDeNghiHoanKyNay: 0n,
            ct43_thueKhauTruChuyenKySau: 0n,
            allIndicators: {},
            warnings: [],
            parseStatus: 'SUCCESS',
            xmlAvailable: false
          };
        }

        // Chỉ lưu cache đĩa & RAM khi đã có XML bóc tách thành công
        if (snapshot && snapshot.xmlAvailable) {
          this.memoryCache.set(cacheKey, snapshot);
          if (this.baseDir) {
            ParsedSnapshotStore.saveSnapshot(this.baseDir, taxpayerId, filing.id, snapshot);
          }
        }
        return snapshot;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        if (res) snapshots.push(res);
      }

      completedCount += batch.length;
      if (onProgress) {
        onProgress(
          Math.min(completedCount, total),
          total,
          `Đã phân tích nhanh ${Math.min(completedCount, total)}/${total} tờ khai GTGT…`
        );
      }
    }

    return VatAnalyticsEngine.buildSummaryFromSnapshots(vatFilings, snapshots, taxpayerId);
  }

  /**
   * Tính toán chuỗi kỳ kê khai, delta từng phiên bản và Data Coverage từ mảng Snapshots
   */
  public static buildSummaryFromSnapshots(
    vatFilings: TaxFiling[],
    snapshots: VatDeclarationSnapshot[],
    taxpayerId: string
  ): VatAnalyticsSummary {
    // ─── XÂY DỰNG CHUỖI KỲ & TÍNH TOÁN DELTA ─────────────────────────────
    const periodGroupMap = new Map<string, VatDeclarationSnapshot[]>();

    for (const snap of snapshots) {
      const pKey = snap.period.normalizedKey;
      if (!periodGroupMap.has(pKey)) {
        periodGroupMap.set(pKey, []);
      }
      periodGroupMap.get(pKey)!.push(snap);
    }

    const periodGroups: VatPeriodGroup[] = [];
    let periodsWithSupplementalCount = 0;
    let periodsWithWarningCount = 0;

    for (const [pKey, groupSnaps] of periodGroupMap.entries()) {
      const sorted = [...groupSnaps].sort((a, b) => {
        const timeA = a.submittedAt ? parseSubmissionTimestamp(a.submittedAt) : 0;
        const timeB = b.submittedAt ? parseSubmissionTimestamp(b.submittedAt) : 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.supplementalNo || 0) - (b.supplementalNo || 0);
      });

      const originalSnapshot = sorted.find(s => s.declarationType === 'ORIGINAL') || null;
      const supplementalSnapshots = sorted.filter(s => s.declarationType === 'SUPPLEMENTAL');
      const finalSnapshot = sorted[sorted.length - 1];

      if (supplementalSnapshots.length > 0) {
        periodsWithSupplementalCount++;
      }

      // Tính Delta từng phiên bản so với bản trước đó
      const versionDeltas: VatVersionDelta[] = [];
      for (let idx = 1; idx < sorted.length; idx++) {
        const current = sorted[idx];
        const previous = sorted[idx - 1];

        const delta24 = current.ct24_thueMuaVao - previous.ct24_thueMuaVao;
        const delta25 = current.ct25_thueKhauTruKyNay - previous.ct25_thueKhauTruKyNay;
        const delta35 = current.ct35_thueBanRa - previous.ct35_thueBanRa;
        const delta40 = current.ct40_thuePhaiNop - previous.ct40_thuePhaiNop;
        const delta43 = current.ct43_thueKhauTruChuyenKySau - previous.ct43_thueKhauTruChuyenKySau;
        const hasChanged = delta24 !== 0n || delta25 !== 0n || delta35 !== 0n || delta40 !== 0n || delta43 !== 0n;

        versionDeltas.push({
          fromVersionLabel: previous.declarationType === 'ORIGINAL' ? 'Chính thức' : `BS lần ${previous.supplementalNo || 1}`,
          toVersionLabel: current.declarationType === 'ORIGINAL' ? 'Chính thức' : `BS lần ${current.supplementalNo || 1}`,
          deltaCt24_thueMuaVao: delta24,
          deltaCt25_thueKhauTruKyNay: delta25,
          deltaCt35_thueBanRa: delta35,
          deltaCt40_thuePhaiNop: delta40,
          deltaCt43_thueKhauTruChuyenKySau: delta43,
          hasChanged
        });
      }

      const warnings: VatChainWarning[] = [];
      if (supplementalSnapshots.length > 0 && !originalSnapshot) {
        warnings.push({
          code: 'MISSING_ORIGINAL',
          message: `Kỳ ${finalSnapshot.period.value} có bản khai bổ sung nhưng thiếu tờ khai chính thức trong kỳ.`,
          severity: 'WARNING'
        });
      }

      if (supplementalSnapshots.some(s => (s.supplementalNo || 0) > 1) && !supplementalSnapshots.some(s => s.supplementalNo === 1)) {
        warnings.push({
          code: 'MISSING_SUPPLEMENT_SEQUENCE',
          message: `Kỳ ${finalSnapshot.period.value} thiếu bản bổ sung lần 1.`,
          severity: 'WARNING'
        });
      }

      if (warnings.length > 0) {
        periodsWithWarningCount++;
      }

      const norm = normalizeVatPeriod(finalSnapshot.period.value, finalSnapshot.submittedAt);
      const groupFilings = vatFilings.filter(f => {
        const fNorm = normalizeVatPeriod(f.period || '', f.submittedAt);
        return fNorm.key === pKey || f.period === finalSnapshot.period.value;
      });

      const groupXmlCount = sorted.filter(s => s.xmlAvailable).length;
      const groupCoverageStatus = groupXmlCount === sorted.length ? 'COMPLETE' : (groupXmlCount > 0 ? 'PARTIAL' : 'UNAVAILABLE');

      periodGroups.push({
        periodKey: pKey,
        periodLabel: finalSnapshot.period.value,
        periodType: finalSnapshot.period.type,
        year: norm.year,
        month: norm.month,
        quarter: norm.quarter,
        filings: groupFilings,
        snapshots: sorted,
        finalSnapshot,
        hasSupplemental: supplementalSnapshots.length > 0,
        supplementalCount: supplementalSnapshots.length,
        hasValueDelta: versionDeltas.some(d => d.hasChanged),
        deltas: versionDeltas,
        warnings,
        xmlAvailableCount: groupXmlCount,
        coverageStatus: groupCoverageStatus
      });
    }

    periodGroups.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      const valA = a.month || (a.quarter ? a.quarter * 3 : 0);
      const valB = b.month || (b.quarter ? b.quarter * 3 : 0);
      return valA - valB;
    });

    const totalXmlAvailableCount = snapshots.filter(s => s.xmlAvailable).length;
    const coverageRatio = vatFilings.length > 0 ? totalXmlAvailableCount / vatFilings.length : 1.0;
    const summaryCoverageStatus = totalXmlAvailableCount === vatFilings.length
      ? 'COMPLETE'
      : (totalXmlAvailableCount > 0 ? 'PARTIAL' : 'UNAVAILABLE');

    return {
      taxpayerId,
      totalFilingsCount: vatFilings.length,
      totalPeriodsCount: periodGroups.length,
      periodsWithSupplementalCount,
      periodsWithWarningCount,
      totalXmlAvailableCount,
      coverageRatio,
      coverageStatus: summaryCoverageStatus,
      periodGroups,
      analyzedAt: new Date().toISOString()
    };
  }
}
