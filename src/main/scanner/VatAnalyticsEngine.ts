import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { ZipExtractor } from '../files/ZipExtractor';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';
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
import { isPathInsideBaseDir } from '../persistence/pathConfinement';

export class VatAnalyticsEngine {
  private client: TaxPortalClient;
  private legacyClient?: LegacyFilingClient;
  private memoryCache = new Map<string, VatDeclarationSnapshot>();
  private isCancelled = false;
  private baseDir = '';
  private taxpayerId = '';
  // filingId -> xmlPath (gom từ TẤT CẢ manifest .tax_manifest.json của MST trên đĩa)
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

  /**
   * Nạp đường dẫn XML đã tải về máy từ các manifest tải hàng loạt
   * ({baseDir}/{MST}_{Năm}/.tax_manifest.json). Trước đây phân tích chỉ đọc
   * downloadedFiles trong bộ nhớ phiên — hồ sơ đã tải ở phiên TRƯỚC không
   * được nhận diện, khiến bảng đối chiếu hiện trống dù file nằm sẵn trên đĩa.
   */
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
    this.manifestXmlPaths = map;
    return map;
  }

  private taxpayerPrefix(): string {
    return this.taxpayerId.split('-')[0] || this.taxpayerId;
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
    this.taxpayerId = taxpayerId;
    this.manifestXmlPaths = null; // nạp lại trạng thái đĩa mới nhất mỗi lần phân tích

    // Lọc các hồ sơ thuộc nhóm GTGT (VAT) và phân giải chuỗi bổ sung chuẩn xác
    const rawVatFilings = filings.filter(
      f => f.taxType === 'VAT' || f.declarationCode === '01/GTGT' || f.title.toLowerCase().includes('gtgt')
    );
    const vatFilings = resolvePeriodSupplementalSequences(rawVatFilings);
    const total = vatFilings.length;
    const snapshots: VatDeclarationSnapshot[] = [];
    const failedXmlDetails: Array<{ submissionId: string; periodLabel: string; reason: string }> = [];

    // Concurrency 2 luồng + nghỉ giữa các batch: Cổng Thuế GDT trả
    // HTTP 429 / chặn tạm khi bị bấm tải song song dồn dập, khiến số liệu
    // các kỳ trước rơi vào fallback toàn số 0 một cách ÂM THẦM.
    const concurrency = 2;
    let completedCount = 0;
    let stopForInfrastructure = false;

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
        // Confinement: chỉ đọc file NẰM TRONG baseDir — path đến từ IPC payload,
        // không kiểm tra thì renderer bị chiếm đọc được file tùy ý.
        const xmlPath = filing.downloadedFiles?.xml;
        if (xmlPath && this.baseDir && isPathInsideBaseDir(this.baseDir, xmlPath) && fs.existsSync(xmlPath)) {
          try {
            const xml = fs.readFileSync(xmlPath, 'utf-8');
            snapshot = VatXmlParser.parseVatXml(xml, filing, taxpayerId);
          } catch {}
        }

        // 3b. XML đã tải về máy qua đợt tải hàng loạt (kể cả phiên TRƯỚC) —
        // tra cứu manifest .tax_manifest.json trên đĩa theo filingId / altIds / kỳ kê khai
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
              snapshot = VatXmlParser.parseVatXml(xml, filing, taxpayerId);
            } catch {}
          }
        }

        // 4. Nếu chưa có XML, tải trực tuyến vào bộ nhớ RAM (bỏ qua nếu mạng Cổng Thuế đang bị 429)
        if (!snapshot && filing.downloadAvailable !== false && !stopForInfrastructure) {
          try {
            const res = await this.downloadHoSoWithRetry(filing);

            if (res.content) {
              const buffer = Buffer.from(res.content, 'base64');
              const xmlCheck = ZipExtractor.cleanXmlBuffer(buffer);
              if (xmlCheck.isXml) {
                snapshot = VatXmlParser.parseVatXml(xmlCheck.text, filing, taxpayerId);
              } else {
                const zip = new AdmZip(buffer);
                // Cap giải nén: chặn zip-bomb (entry khai báo/giải nén > 50MB bỏ qua)
                const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
                for (const entry of zip.getEntries()) {
                  if (!entry.entryName.toLowerCase().endsWith('.xml')) continue;
                  if (entry.header.size > MAX_ENTRY_BYTES) continue;
                  const xml = entry.getData().toString('utf-8');
                  if (Buffer.byteLength(xml) > MAX_ENTRY_BYTES) continue;
                  snapshot = VatXmlParser.parseVatXml(xml, filing, taxpayerId);
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

        // 5. Fallback metadata snapshot (khi không tải được XML) — KHÔNG được
        // đánh dấu SUCCESS: phải gắn FAILED để UI cảnh báo "số liệu trống do
        // chưa tải được XML" thay vì im lặng hiển thị số 0 như số thật.
        if (!snapshot) {
          const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
          const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
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
            parseStatus: 'FAILED',
            errorMessage: failReason,
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

      if (i + concurrency < total && !this.isCancelled) {
        // Sau lỗi hạ tầng, các batch còn lại chỉ tạo snapshot FAILED local;
        // không được bỏ qua hồ sơ và làm sai tổng coverage.
        await new Promise(r => setTimeout(r, 250));
      }
    }

    return VatAnalyticsEngine.buildSummaryFromSnapshots(vatFilings, snapshots, taxpayerId, failedXmlDetails);
  }

  /**
   * Tải hồ sơ theo thứ tự eTax → DVC cho các tờ khai thuế.
   *
   * Nhiều hồ sơ do eTax phát hành vẫn xuất hiện trong bảng DVC nhưng
   * validateIdTkhai trả 400 và downloadHoSo trả 500. DVC-first vừa thất bại
   * vừa tạo thêm request khi eTax có thể tải được hồ sơ gốc.
   */
  private async downloadHoSoWithRetry(filing: TaxFiling, maxRetries = 1): Promise<{ fileName: string; fileType: string; content: string }> {
    let lastErr: unknown;
    const shouldTryLegacyFirst = Boolean(
      this.legacyClient &&
      (filing.source === 'dvc-etax-html' || Boolean(filing.messageId))
    );

    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 6000);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.isCancelled) {
        clearTimeout(timer);
        const cancelErr = Object.assign(new Error('Phân tích đã bị hủy'), { code: 'CANCELLED' });
        throw cancelErr;
      }
      try {
        if (shouldTryLegacyFirst && this.legacyClient) {
          if (filing.messageId) {
            try {
              const legacyFile = await this.legacyClient.downloadFiling(filing.messageId, abortCtrl.signal);
              clearTimeout(timer);
              return {
                fileName: legacyFile.fileName,
                fileType: legacyFile.contentType,
                content: legacyFile.dataBuffer.toString('base64')
              };
            } catch (legacyDirectErr: unknown) {
              const errObj = legacyDirectErr as any;
              if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
                clearTimeout(timer);
                throw legacyDirectErr;
              }
            }
          }

          try {
            const legacyFile = await this.legacyClient.resolveAndDownloadFiling(this.taxpayerId, filing, abortCtrl.signal);
            if (legacyFile?.dataBuffer && legacyFile.dataBuffer.length > 0) {
              clearTimeout(timer);
              return {
                fileName: legacyFile.fileName,
                fileType: legacyFile.contentType,
                content: legacyFile.dataBuffer.toString('base64')
              };
            }
          } catch (legacyErr: unknown) {
            const errObj = legacyErr as any;
            if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
              clearTimeout(timer);
              throw legacyErr;
            }
          }
        }

        try {
          const dvcPayload = await this.client.downloadHoSo(filing.id, abortCtrl.signal, {
            isThueDienTu: filing.isThueDienTu,
            loaiTraCuu: filing.loaiTraCuu,
            maTkhai: filing.maTkhai,
            altIds: filing.altIds,
            period: filing.period,
            declarationCode: filing.declarationCode
          });
          clearTimeout(timer);
          return dvcPayload;
        } catch (dvcErr: unknown) {
          if (this.legacyClient && !shouldTryLegacyFirst && typeof this.legacyClient.resolveAndDownloadFiling === 'function') {
            try {
              const legacyFile = await this.legacyClient.resolveAndDownloadFiling(this.taxpayerId, filing, abortCtrl.signal);
              if (legacyFile?.dataBuffer && legacyFile.dataBuffer.length > 0) {
                clearTimeout(timer);
                return {
                  fileName: legacyFile.fileName,
                  fileType: legacyFile.contentType,
                  content: legacyFile.dataBuffer.toString('base64')
                };
              }
            } catch (legacyErr: unknown) {
              const errObj = legacyErr as any;
              if (errObj?.code === 'RATE_LIMIT' || errObj?.code === 'SESSION_EXPIRED' || errObj?.code === 'AUTH_REQUIRED' || errObj?.code === 'CANCELLED' || errObj?.status === 429) {
                clearTimeout(timer);
                throw legacyErr;
              }
            }
          }
          clearTimeout(timer);
          throw dvcErr;
        }
      } catch (err: unknown) {
        clearTimeout(timer);
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Tính toán chuỗi kỳ kê khai, delta từng phiên bản và Data Coverage từ mảng Snapshots
   */
  public static buildSummaryFromSnapshots(
    vatFilings: TaxFiling[],
    snapshots: VatDeclarationSnapshot[],
    taxpayerId: string,
    failedXmlDetails?: Array<{ submissionId: string; periodLabel: string; reason: string }>
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

      const validSnaps = sorted.filter(s => s.xmlAvailable !== false);
      const originalSnapshot = sorted.find(s => s.declarationType === 'ORIGINAL') || null;
      const supplementalSnapshots = sorted.filter(s => s.declarationType === 'SUPPLEMENTAL');
      const finalSnapshot = validSnaps.length > 0 ? validSnaps[validSnaps.length - 1] : sorted[sorted.length - 1];

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

      // Cảnh báo hồ sơ KHÔNG có XML: số liệu đang hiển thị là fallback 0,
      // người dùng phải biết đây là "thiếu dữ liệu" chứ không phải "không phát sinh"
      const missingXmlSnaps = sorted.filter(s => !s.xmlAvailable);
      if (missingXmlSnaps.length > 0) {
        warnings.push({
          code: 'XML_DOWNLOAD_FAILED',
          message: `${missingXmlSnaps.length} tờ khai của kỳ ${finalSnapshot.period.value} chưa tải được file XML (${missingXmlSnaps.map(s => s.errorMessage || 'lỗi không rõ').join('; ')}). Số liệu hiển thị đang TRỐNG, không phải số liệu thật.`,
          severity: 'WARNING'
        });
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

    const failedXml = failedXmlDetails && failedXmlDetails.length > 0
      ? failedXmlDetails
      : snapshots
          .filter(s => !s.xmlAvailable)
          .map(s => ({
            submissionId: s.submissionId,
            periodLabel: s.period.value,
            reason: s.errorMessage || 'Không tải được file XML từ Cổng Thuế'
          }));

    return {
      taxpayerId,
      totalFilingsCount: vatFilings.length,
      totalPeriodsCount: periodGroups.length,
      periodsWithSupplementalCount,
      periodsWithWarningCount,
      totalXmlAvailableCount,
      coverageRatio,
      coverageStatus: summaryCoverageStatus,
      failedXmlCount: failedXml.length,
      failedXmlDetails: failedXml,
      periodGroups,
      analyzedAt: new Date().toISOString()
    };
  }
}
