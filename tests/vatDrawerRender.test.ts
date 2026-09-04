import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { VatReferenceDrawer } from '../src/renderer/components/VatReferenceDrawer';
import { PaymentSlipStatsModal } from '../src/renderer/components/PaymentSlipStatsModal';
import { VatAnalyticsSummary } from '../src/shared/vatAnalyticsTypes';
import { GntStatisticsResult } from '../src/main/engine/GntStatisticsEngine';

describe('VAT and GNT Drawers/Modals - Rules of Hooks and Render Lifecycle', () => {
  it('VatReferenceDrawer renders cleanly with isOpen: false and isOpen: true without hook violations', () => {
    const mockSummary: VatAnalyticsSummary = {
      taxpayerId: '0101234567',
      totalFilingsCount: 0,
      totalPeriodsCount: 0,
      periodsWithSupplementalCount: 0,
      periodsWithWarningCount: 0,
      periodGroups: [],
      failedXmlDetails: [],
      analyzedAt: new Date().toISOString()
    };

    // 1. Render when drawer is closed (isOpen: false)
    const closedHtml = renderToString(
      React.createElement(VatReferenceDrawer, {
        isOpen: false,
        isLoading: false,
        onClose: () => {},
        onExportExcel: () => {},
        onRefreshAnalytics: () => {},
        summary: mockSummary,
        targetYear: 2026
      })
    );
    expect(closedHtml).toBe('');

    // 2. Render when drawer is opened (isOpen: true) - would trigger Minified React Error #310 if hooks are conditional
    const openHtml = renderToString(
      React.createElement(VatReferenceDrawer, {
        isOpen: true,
        isLoading: false,
        onClose: () => {},
        onExportExcel: () => {},
        onRefreshAnalytics: () => {},
        summary: mockSummary,
        targetYear: 2026
      })
    );
    expect(openHtml).toContain('ĐỐI CHIẾU KÊ KHAI THUẾ');
    expect(openHtml).toContain('Mẫu 01/GTGT');
  });

  it('PaymentSlipStatsModal renders cleanly with isOpen: false and isOpen: true without hook violations', () => {
    const mockStats: GntStatisticsResult = {
      cells: [],
      monthKeys: [],
      activeBuckets: [],
      paidCount: 0,
      skippedUnpaidCount: 0,
      noDetailCount: 0,
      grandTotal: 0
    };

    // 1. Closed
    const closedHtml = renderToString(
      React.createElement(PaymentSlipStatsModal, {
        isOpen: false,
        loading: false,
        stats: mockStats,
        error: null,
        year: 2026,
        onClose: () => {},
        onExportExcel: () => {}
      })
    );
    expect(closedHtml).toBe('');

    // 2. Open
    const openHtml = renderToString(
      React.createElement(PaymentSlipStatsModal, {
        isOpen: true,
        loading: false,
        stats: mockStats,
        error: null,
        year: 2026,
        onClose: () => {},
        onExportExcel: () => {}
      })
    );
    expect(openHtml).toContain('Thống kê Giấy Nộp Tiền đã nộp');
  });
});
