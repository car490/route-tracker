// src/features/journeys/journeyReportHtml.test.js
//
// Pure string-building coverage for the printable journey report — no DOM,
// no @testing-library/react (this project intentionally has neither). The
// only thing under test is that database-sourced free text (driver name,
// incident description, stop name, the departure label) is HTML-escaped
// before it lands in the report's HTML string.

import { describe, it, expect } from 'vitest';
import { buildJourneyReportHtml } from './journeyReportHtml.js';

const XSS = '<img src=x onerror=alert(1)>';

describe('buildJourneyReportHtml', () => {
  it('escapes database-sourced text and never emits a literal <img tag', () => {
    const j = {
      journey_date: '2026-09-17',
      status: 'completed',
      started_at: null,
      completed_at: null,
      driver: { name: XSS },
      vehicle: { registration: 'AB12 CDE' },
      departure: { timetable: { route: { service_code: 'S1' } } },
    };
    const stops = [
      {
        timetable_stop: {
          sequence: 1,
          stop: { name: XSS },
          stop_type: 'timing_point',
          scheduled_time: '08:00',
        },
        arrived_at: null,
        variance_seconds: null,
      },
    ];
    const incidents = [
      {
        occurred_at: null,
        metadata: { category: XSS, description: XSS, near_stop: XSS },
      },
    ];

    const html = buildJourneyReportHtml(j, stops, incidents, XSS);

    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('still renders safe, non-HTML content normally', () => {
    const j = {
      journey_date: '2026-09-17',
      status: 'completed',
      started_at: null,
      completed_at: null,
      driver: { name: 'Jane Doe' },
      vehicle: { registration: 'AB12 CDE' },
      departure: { timetable: { route: { service_code: 'S1' } } },
    };
    const html = buildJourneyReportHtml(j, [], [], 'S1 Outbound @ 08:00');

    expect(html).toContain('Jane Doe');
    expect(html).toContain('S1 Outbound @ 08:00');
    expect(html).toContain('No stop times recorded');
  });
});
