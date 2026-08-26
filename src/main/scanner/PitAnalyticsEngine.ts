import AdmZip from 'adm-zip';
import fs from 'fs';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { TaxFiling } from '../../shared/types';
import {
  PitAnalyticsSummary,
  PitDeclarationSnapshot,
  PitPeriodGroup
} from '../../shared/pitAnalyticsTypes';
import { PitXmlParser } from './PitXmlParser';
import {
  normalizeVatPeriod,
  parseSubmissionTimestamp,
  resolvePeriodSupplementalSequences
} from '../../shared/dateUtils';
import { ParsedSnapshotStore } from '../persistence/ParsedSnapshotStore';
import { isPathInsideBaseDir } from '../persistence/pathConfinement';

export class PitAnalyticsEngine {
  private client: TaxPortalClient;
  private memoryCache = new Map<string, PitDeclarationSnapshot>();
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
   * Phân tích danh sách hồ sơ TNCN trong năm với bộ tăng tốc Local-First & Snapshot Cache
   */
  public async analyzePitFilings(
    filings: TaxFiling[],
    taxpayerId: string,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<PitAnalyticsSummary> {
    this.isCancelled = false;

    // Lọc các hồ sơ thuộc nhóm TNCN (PIT)
    const rawPitFilings = filings.filter(
      f =>
        f.taxType === 'PIT' ||
        (f.declarationCode || '').includes('TNCN') ||
        (f.declarationCode || '').includes('05/KK') ||
        (f.declarationCode || '').includes('05/QTT') ||
        f.title.toLowerCase().includes('thu nhập cá nhân') ||
        f.title.toLowerCase().includes('tncn')
    );

    const pitFilings = resolvePeriodSupplementalSequences(rawPitFilings);
    const total = pitFilings.length;
    const snapshots: PitDeclarationSnapshot[] = [];

    // Concurrency 5 luồng tải song song
    const concurrency = 5;
    let completedCount = 0;

    for (let i = 0; i < total; i += concurrency) {
      if (this.isCancelled) break;
      const batch = pitFilings.slice(i, i + concurrency);

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
          const diskSnap = ParsedSnapshotStore.getSnapshot<PitDeclarationSnapshot>(
            this.baseDir,
            taxpayerId,
            filing.id
          );
          if (diskSnap && diskSnap.xmlAvailable) {
            this.memoryCache.set(cacheKey, diskSnap);
            return diskSnap;
          }
        }

        let snapshot: PitDeclarationSnapshot | null = null;

        // 3. Đọc từ file XML đã tải sẵn trong máy (1ms)
        // Confinement: chỉ đọc file nằm trong baseDir (path đến từ IPC payload)
        const xmlPath = filing.downloadedFiles?.xml;
        if (xmlPath && this.baseDir && isPathInsideBaseDir(this.baseDir, xmlPath) && fs.existsSync(xmlPath)) {
          try {
            const xml = fs.readFileSync(xmlPath, 'utf-8');
            snapshot = PitXmlParser.parsePitXml(xml, filing, taxpayerId);
          } catch {}
        }

        // 4. Nếu chưa có XML, tải trực tiếp vào RAM
        if (!snapshot && filing.downloadAvailable) {
          try {
            const res = await this.client.downloadHoSo(filing.id, undefined, {
              isThueDienTu: filing.isThueDienTu,
              loaiTraCuu: filing.loaiTraCuu
            });

            if (res.content) {
              const zip = new AdmZip(Buffer.from(res.content, 'base64'));
              // Cap giải nén: chặn zip-bomb (entry khai báo/giải nén > 50MB bỏ qua)
              const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
              for (const entry of zip.getEntries()) {
                if (!entry.entryName.toLowerCase().endsWith('.xml')) continue;
                if (entry.header.size > MAX_ENTRY_BYTES) continue;
                const xml = entry.getData().toString('utf-8');
                if (Buffer.byteLength(xml) > MAX_ENTRY_BYTES) continue;
                snapshot = PitXmlParser.parsePitXml(xml, filing, taxpayerId);
                break;
              }
            }
          } catch {}
        }

        // 5. Fallback metadata snapshot
        if (!snapshot) {
          const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
          const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
          const isFinal =
            filing.filingType === 'FINALIZATION' ||
            (filing.declarationCode || '').includes('05/QTT') ||
            filing.title.toLowerCase().includes('quyết toán');

          snapshot = {
            submissionId: filing.id,
            formCode: isFinal ? '05/QTT-TNCN' : filing.declarationCode || '05/KK-TNCN',
            periodKey: isFinal ? `${norm.year}-YEAR` : norm.key,
            periodLabel: isFinal ? `Quyết toán năm ${norm.year}` : norm.label,
            year: norm.year,
            month: isFinal ? undefined : norm.month,
            quarter: isFinal ? undefined : norm.quarter,
            isQuarter: norm.type === 'QUARTER' && !isFinal,
            isYear: isFinal,
            versionType: filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL',
            supplementalNo: filing.supplementalNo || 0,
            submittedAt: filing.submittedAt,
            status: filing.status || 'Đã nộp',
            ct21_tongSoNguoiLaoDong: 0n,
            ct22_caNhanCuTru: 0n,
            ct24_tongThuNhapChiuThue: 0n,
            ct27_tongThuNhapChiuThueKhauTru: 0n,
            ct31_tongThueTncnDaKhauTru: 0n,
            ct32_khauTruCaNhanCuTru: 0n,
            ct33_khauTruCaNhanKhongCuTru: 0n,
            ct34_tongThueKhauTru: 0n,
            ct35_tongThuePhaiNop: 0n,
            isFinalization: isFinal
          };
        }

        // Chỉ lưu cache đĩa & RAM khi đã có XML bóc tách thành công
        if (snapshot && (snapshot.ct24_tongThuNhapChiuThue > 0n || snapshot.ct21_tongSoNguoiLaoDong > 0n || snapshot.rawXml)) {
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
          `Đã phân tích nhanh ${Math.min(completedCount, total)}/${total} tờ khai TNCN…`
        );
      }
    }

    // ─── XÂY DỰNG CHUỖI KỲ & TÍNH TOÁN ─────────────────────────────────
    const periodGroupMap = new Map<string, PitDeclarationSnapshot[]>();
    let finalizationSnapshot: PitDeclarationSnapshot | null = null;

    for (const snap of snapshots) {
      if (snap.isFinalization) {
        if (!finalizationSnapshot || (snap.submittedAt && finalizationSnapshot.submittedAt && snap.submittedAt > finalizationSnapshot.submittedAt)) {
          finalizationSnapshot = snap;
        }
      }

      const pKey = snap.periodKey;
      if (!periodGroupMap.has(pKey)) {
        periodGroupMap.set(pKey, []);
      }
      periodGroupMap.get(pKey)!.push(snap);
    }

    const periodGroups: PitPeriodGroup[] = [];

    for (const [pKey, groupSnaps] of periodGroupMap.entries()) {
      const sorted = [...groupSnaps].sort((a, b) => {
        const timeA = a.submittedAt ? parseSubmissionTimestamp(a.submittedAt) : 0;
        const timeB = b.submittedAt ? parseSubmissionTimestamp(b.submittedAt) : 0;
        if (timeA !== timeB) return timeA - timeB;
        return a.supplementalNo - b.supplementalNo;
      });

      const supplementalSnapshots = sorted.filter(s => s.versionType === 'SUPPLEMENTAL');
      const finalSnapshot = sorted[sorted.length - 1] || null;

      periodGroups.push({
        periodKey: pKey,
        periodLabel: finalSnapshot?.periodLabel || pKey,
        periodType: finalSnapshot?.isYear ? 'YEAR' : finalSnapshot?.isQuarter ? 'QUARTER' : 'MONTH',
        year: finalSnapshot?.year || new Date().getFullYear(),
        month: finalSnapshot?.month,
        quarter: finalSnapshot?.quarter,
        snapshots: sorted,
        finalSnapshot,
        hasSupplemental: supplementalSnapshots.length > 0,
        supplementalCount: supplementalSnapshots.length
      });
    }

    periodGroups.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      const valA = a.month || (a.quarter ? a.quarter * 3 : 99);
      const valB = b.month || (b.quarter ? b.quarter * 3 : 99);
      return valA - valB;
    });

    return {
      taxpayerId,
      totalFilingsAnalyzed: snapshots.length,
      periodGroups,
      finalizationSnapshot,
      analyzedAt: new Date().toISOString()
    };
  }
}
