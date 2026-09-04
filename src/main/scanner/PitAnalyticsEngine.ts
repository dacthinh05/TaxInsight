import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { ZipExtractor } from '../files/ZipExtractor';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';
import { TaxFiling } from '../../shared/types';
import {
  PitAnalyticsSummary,
  PitDeclarationSnapshot,
  PitPeriodGroup
} from '../../shared/pitAnalyticsTypes';
import { PitXmlParser } from './PitXmlParser';
import {
  normalizeVatPeriod,
  parseFilingPeriod,
  parseSubmissionTimestamp,
  resolvePeriodSupplementalSequences
} from '../../shared/dateUtils';
import { ParsedSnapshotStore } from '../persistence/ParsedSnapshotStore';
import { isPathInsideBaseDir } from '../persistence/pathConfinement';

export class PitAnalyticsEngine {
  private client: TaxPortalClient;
  private legacyClient?: LegacyFilingClient;
  private memoryCache = new Map<string, PitDeclarationSnapshot>();
  private isCancelled = false;
  private baseDir = '';
  private taxpayerId = '';
  private manifestXmlPaths: Map<string, string> | null = null;

  constructor(client: TaxPortalClient, baseDir = '', legacyClient?: LegacyFilingClient) {
    this.client = client;
    this.baseDir = baseDir;
    this.legacyClient = legacyClient;
  }

  public setBaseDir(baseDir: string) {
    this.baseDir = baseDir;
  }

  public cancel() {
    this.isCancelled = true;
  }

  private loadManifestXmlPaths(): Map<string, string> {
    if (this.manifestXmlPaths) return this.manifestXmlPaths;
    const map = new Map<string, string>();
    try {
      if (this.baseDir && fs.existsSync(this.baseDir)) {
        const rawTaxCode = this.taxpayerId.trim();
        const baseTaxCode = this.taxpayerPrefix().trim();
        const safeTaxCode = rawTaxCode.replace(/[^a-zA-Z0-9_-]/g, '_');

        // 1. Quét manifest ở thư mục gốc baseDir (cho cấu trúc lưu chung 1 thư mục)
        const rootManifests = [
          path.join(this.baseDir, `.tax_manifest_${rawTaxCode}.json`),
          path.join(this.baseDir, `.tax_manifest_${safeTaxCode}.json`),
          path.join(this.baseDir, `.tax_manifest_${baseTaxCode}.json`),
          path.join(this.baseDir, '.tax_manifest.json')
        ];
        for (const mfPath of rootManifests) {
          if (fs.existsSync(mfPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(mfPath, 'utf-8'));
              for (const [filingId, entry] of Object.entries<any>(raw || {})) {
                if (entry?.xmlPath && fs.existsSync(entry.xmlPath)) {
                  map.set(filingId, entry.xmlPath);
                }
              }
            } catch {}
          }
        }

        // 2. Quét các thư mục con và file XML trong baseDir
        for (const dirName of fs.readdirSync(this.baseDir)) {
          const fullDirPath = path.join(this.baseDir, dirName);
          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(fullDirPath);
          } catch {
            continue;
          }

          if (stat.isDirectory()) {
            const isMatchingTaxDir =
              dirName.startsWith(`${rawTaxCode}_`) ||
              dirName.startsWith(`${safeTaxCode}_`) ||
              dirName.startsWith(`${baseTaxCode}_`) ||
              dirName.startsWith(`${baseTaxCode}-`) ||
              dirName === rawTaxCode ||
              dirName === safeTaxCode;

            if (isMatchingTaxDir) {
              const manifestPath = path.join(fullDirPath, '.tax_manifest.json');
              if (fs.existsSync(manifestPath)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                  for (const [filingId, entry] of Object.entries<any>(raw || {})) {
                    if (entry?.xmlPath && fs.existsSync(entry.xmlPath)) {
                      map.set(filingId, entry.xmlPath);
                    }
                  }
                } catch {}
              }
            }
          } else if (stat.isFile() && dirName.toLowerCase().endsWith('.xml')) {
            // Hỗ trợ quét trực tiếp các file XML lưu ở thư mục gốc baseDir
            const cleanName = dirName.slice(0, -4);
            map.set(cleanName, fullDirPath);
            const parts = cleanName.split('_');
            for (const part of parts) {
              if (part && part.length >= 4 && !map.has(part)) {
                map.set(part, fullDirPath);
              }
            }
            const m = cleanName.match(/(?:Thang|tháng|Quy|quý|Nam|năm)[\s\-_]*0?(\d{1,2})[\s\-_]*(20\d{2})/i);
            const isBS = cleanName.toLowerCase().includes('bosung') || cleanName.toLowerCase().includes('bs');
            const bsNum = cleanName.match(/(?:bosung|bs)[\-_]?l?(\d+)/i)?.[1] || (isBS ? '1' : '0');
            if (m) {
              const numVal = parseInt(m[1], 10);
              const yr = m[2];
              const isQuarter = /Quy|quý/i.test(m[0]);
              const isYear = /Nam|năm/i.test(m[0]);

              if (isQuarter) {
                map.set(`${yr}-Q${numVal}`, fullDirPath);
                map.set(`${yr}-Q${numVal}_${bsNum}`, fullDirPath);
                map.set(`Q_${numVal}_${yr}`, fullDirPath);
                map.set(`Q_${numVal}_${yr}_${bsNum}`, fullDirPath);
              } else if (!isYear) {
                const padM = numVal < 10 ? `0${numVal}` : `${numVal}`;
                map.set(`${yr}-M${padM}`, fullDirPath);
                map.set(`${yr}-M${padM}_${bsNum}`, fullDirPath);
                map.set(`${yr}-M${numVal}`, fullDirPath);
                map.set(`${yr}-M${numVal}_${bsNum}`, fullDirPath);
                map.set(`M_${numVal}_${yr}`, fullDirPath);
                map.set(`M_${numVal}_${yr}_${bsNum}`, fullDirPath);
              } else {
                map.set(`${yr}-YEAR`, fullDirPath);
                map.set(`${yr}-YEAR_${bsNum}`, fullDirPath);
              }
            }
          }
        }
      }
    } catch {}
    return map;
  }

  private taxpayerPrefix(): string {
    return this.taxpayerId.split('-')[0] || this.taxpayerId;
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
    this.taxpayerId = taxpayerId;
    this.manifestXmlPaths = null;
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
    const failedXmlDetails: Array<{ submissionId: string; periodLabel: string; reason: string }> = [];

    // Concurrency thấp (2 luồng) + nghỉ giữa các batch để tránh kích hoạt HTTP 429 Rate Limit
    const concurrency = 2;
    let completedCount = 0;
    let stopForInfrastructure = false;
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

        // 3b. Tra cứu manifest .tax_manifest.json trên đĩa theo filingId / altIds / period
        if (!snapshot) {
          const map = this.loadManifestXmlPaths();
          let manifestXml = map.get(filing.id);
          if (!manifestXml && filing.altIds) {
            for (const alt of filing.altIds) {
              if (map.has(alt)) { manifestXml = map.get(alt); break; }
            }
          }
          if (!manifestXml) {
            const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
            const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
            const bsNum = filing.filingType === 'SUPPLEMENTAL' ? String(filing.supplementalNo || 1) : '0';
            manifestXml =
              map.get(`${norm.key}_${bsNum}`) ||
              map.get(norm.key) ||
              map.get(`${norm.year}-M${norm.month ? (norm.month < 10 ? `0${norm.month}` : norm.month) : ''}`) ||
              map.get(`${norm.year}-Q${norm.quarter}`) ||
              map.get(`M_${norm.month}_${norm.year}`) ||
              map.get(filing.id);
          }
          if (
            manifestXml &&
            (!this.baseDir || isPathInsideBaseDir(this.baseDir, manifestXml)) &&
            fs.existsSync(manifestXml)
          ) {
            try {
              const xml = fs.readFileSync(manifestXml, 'utf-8');
              snapshot = PitXmlParser.parsePitXml(xml, filing, taxpayerId);
            } catch {}
          }
        }

        // 4. Nếu chưa có XML, tải trực tiếp vào RAM (bỏ qua nếu mạng Cổng Thuế đang bị 429)
        if (!snapshot && filing.downloadAvailable !== false && !stopForInfrastructure) {
          try {
            const res = await this.downloadHoSoWithRetry(filing);

            if (res.content) {
              const buffer = Buffer.from(res.content, 'base64');
              const xmlCheck = ZipExtractor.cleanXmlBuffer(buffer);
              if (xmlCheck.isXml) {
                snapshot = PitXmlParser.parsePitXml(xmlCheck.text, filing, taxpayerId);
              } else {
                const zip = new AdmZip(buffer);
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
            }
          } catch (dlErr: any) {
            if (dlErr?.code === 'CANCELLED') this.isCancelled = true;
            if (
              ['RATE_LIMIT', 'SESSION_EXPIRED'].includes(String(dlErr?.code || '')) ||
              Number(dlErr?.httpStatus || dlErr?.response?.status || 0) === 429
            ) {
              stopForInfrastructure = true;
            }
            failedXmlDetails.push({
              submissionId: filing.id,
              periodLabel: filing.period || filing.periodNormalized?.raw || '',
              reason: dlErr?.message || 'Lỗi không xác định khi tải hồ sơ'
            });
          }
        }
        // 5. Fallback metadata snapshot
        if (!snapshot) {
          const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
          const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
          const isFinal =
            filing.filingType === 'FINALIZATION' ||
            (filing.declarationCode || '').includes('05/QTT') ||
            filing.title.toLowerCase().includes('quyết toán');
          const failReason = failedXmlDetails.find(f => f.submissionId === filing.id)?.reason
            || (filing.downloadAvailable ? 'Không tải được file XML từ Cổng Thuế' : 'Hồ sơ không cho phép tải file đính kèm');
          if (!failedXmlDetails.find(f => f.submissionId === filing.id)) {
            failedXmlDetails.push({
              submissionId: filing.id,
              periodLabel: filing.period || filing.periodNormalized?.raw || '',
              reason: failReason
            });
          }

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
            isFinalization: isFinal,
            xmlAvailable: false,
            parseStatus: 'FAILED',
            errorMessage: failReason
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

      if (i + concurrency < total && !this.isCancelled) {
        // Sau lỗi hạ tầng, các batch còn lại chỉ tạo snapshot FAILED local;
        // không được bỏ qua hồ sơ và làm sai tổng coverage.
        await new Promise(r => setTimeout(r, 250));
      }
    }

    // ─── XÂY DỰNG CHUỖI KỲ & TÍNH TOÁN ─────────────────────────────────
    const periodGroupMap = new Map<string, PitDeclarationSnapshot[]>();
    let finalizationSnapshot: PitDeclarationSnapshot | null = null;

    for (const snap of snapshots) {
      if (snap.isFinalization && snap.xmlAvailable !== false) {
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
      const usableSnapshots = sorted.filter(snapshot => snapshot.xmlAvailable !== false);
      const finalSnapshot = usableSnapshots[usableSnapshots.length - 1] || null;

      periodGroups.push({
        periodKey: pKey,
        periodLabel: finalSnapshot?.periodLabel || sorted[sorted.length - 1]?.periodLabel || pKey,
        periodType: (finalSnapshot || sorted[sorted.length - 1])?.isYear
          ? 'YEAR'
          : (finalSnapshot || sorted[sorted.length - 1])?.isQuarter
            ? 'QUARTER'
            : 'MONTH',
        year: (finalSnapshot || sorted[sorted.length - 1])?.year || new Date().getFullYear(),
        month: (finalSnapshot || sorted[sorted.length - 1])?.month,
        quarter: (finalSnapshot || sorted[sorted.length - 1])?.quarter,
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

    const totalXmlAvailableCount = snapshots.filter(snapshot => snapshot.xmlAvailable !== false).length;
    return {
      taxpayerId,
      totalFilingsAnalyzed: snapshots.length,
      periodGroups,
      finalizationSnapshot,
      analyzedAt: new Date().toISOString(),
      totalXmlAvailableCount,
      failedXmlCount: snapshots.length - totalXmlAvailableCount,
      coverageStatus: snapshots.length === totalXmlAvailableCount
        ? 'COMPLETE'
        : totalXmlAvailableCount > 0
          ? 'PARTIAL'
          : 'UNAVAILABLE',
      failedXmlDetails
    };
  }
  private async downloadHoSoWithRetry(filing: TaxFiling, maxRetries = 3): Promise<{ fileName: string; fileType: string; content: string }> {
    let lastErr: unknown;
    const shouldTryLegacyFirst = Boolean(
      this.legacyClient &&
      (filing.source === 'dvc-etax-html' || Boolean(filing.messageId))
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.isCancelled) {
        const cancelErr = Object.assign(new Error('Phân tích đã bị hủy'), { code: 'CANCELLED' });
        throw cancelErr;
      }
      try {
        if (shouldTryLegacyFirst && this.legacyClient) {
          if (filing.messageId) {
            try {
              const legacyFile = await this.legacyClient.downloadFiling(filing.messageId);
              return {
                fileName: legacyFile.fileName,
                fileType: legacyFile.contentType,
                content: legacyFile.dataBuffer.toString('base64')
              };
            } catch (legacyDirectErr: unknown) {
              const errObj = legacyDirectErr as any;
              if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
                throw legacyDirectErr;
              }
              console.warn(`[PitAnalyticsEngine] Tải eTax trực tiếp thất bại (${String(legacyDirectErr)}), thử tra cứu theo hồ sơ`);
            }
          }

          try {
            const legacyFile = await this.legacyClient.resolveAndDownloadFiling(this.taxpayerId, filing);
            if (legacyFile?.dataBuffer && legacyFile.dataBuffer.length > 0) {
              return {
                fileName: legacyFile.fileName,
                fileType: legacyFile.contentType,
                content: legacyFile.dataBuffer.toString('base64')
              };
            }
          } catch (legacyErr: unknown) {
            const errObj = legacyErr as any;
            if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
              throw legacyErr;
            }
            console.warn(`[PitAnalyticsEngine] Tải qua eTax thất bại (${String(legacyErr)}), chuyển sang Cổng DVC`);
          }
        }

        try {
          return await this.client.downloadHoSo(filing.id, undefined, {
            isThueDienTu: filing.isThueDienTu,
            loaiTraCuu: filing.loaiTraCuu,
            maTkhai: filing.maTkhai,
            altIds: filing.altIds,
            period: filing.period,
            declarationCode: filing.declarationCode
          });
        } catch (dvcErr: unknown) {
          if (this.legacyClient && !shouldTryLegacyFirst && typeof this.legacyClient.resolveAndDownloadFiling === 'function') {
            try {
              const legacyFile = await this.legacyClient.resolveAndDownloadFiling(this.taxpayerId, filing);
              if (legacyFile?.dataBuffer && legacyFile.dataBuffer.length > 0) {
                return {
                  fileName: legacyFile.fileName,
                  fileType: legacyFile.contentType,
                  content: legacyFile.dataBuffer.toString('base64')
                };
              }
            } catch (etaxErr: unknown) {
              const errObj = etaxErr as any;
              if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
                throw etaxErr;
              }
              console.warn(`[PitAnalyticsEngine] eTax fallback thất bại cho ${filing.period}:`, String(etaxErr));
            }
          }
          throw dvcErr;
        }
      } catch (err: unknown) {
        lastErr = err;
        const errorCode =
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
            ? err.code
            : undefined;
        if (errorCode === 'CANCELLED' || errorCode === 'SESSION_EXPIRED' || errorCode === 'RATE_LIMIT' || errorCode === 'AUTH_REQUIRED') throw err;
        if (errorCode === 'TIMEOUT' || errorCode === 'NETWORK') {
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
