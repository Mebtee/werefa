import { describe, expect, it } from 'vitest';
import { BOOKING_NOTIFICATION_TYPE } from '../../src/booking/booking-notifications';
import {
  escapeHtml,
  renderCustomerTelegram,
  renderOwnerAffectedEmail,
  formatBookingLine,
} from '../../src/notifications/notification-templates';
import type { DeliveryBookingContext } from '../../src/notifications/notification-catalog';
import { SCHEDULE_AFFECTED_TYPE } from '../../src/schedule/schedule.service';

const BOOKING: DeliveryBookingContext = {
  bookingId: '00000000-0000-0000-0000-000000000001',
  businessId: '00000000-0000-0000-0000-000000000099',
  businessName: 'Test Salon',
  customerName: 'Selam',
  customerPhone: '+251911000000',
  startAt: '2026-10-05T08:30:00.000Z',
  endAt: '2026-10-05T09:00:00.000Z',
  status: 'CONFIRMED',
  services: [
    { name: 'Haircut', durationMinutes: 30 },
    { name: 'Color', durationMinutes: 60 },
  ],
};

describe('escapeHtml', () => {
  it('escapes the 5 dangerous characters', () => {
    expect(escapeHtml('<b>"O\'M & x</b>')).toBe('&lt;b&gt;&quot;O&#39;M &amp; x&lt;/b&gt;');
  });
  it('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('formatBookingLine', () => {
  it('formats UTC+3 display', () => {
    // 2026-10-05T08:30Z → 11:30 UTC+3
    const line = formatBookingLine(new Date('2026-10-05T08:30:00.000Z'));
    expect(line).toMatch(/11:30/);
  });
});

describe('renderCustomerTelegram', () => {
  it('renders a confirmed message with services', () => {
    const msg = renderCustomerTelegram(BOOKING_NOTIFICATION_TYPE.confirmed, BOOKING, {});
    expect(msg.text).toContain('Test Salon');
    expect(msg.text).toContain('Haircut');
    expect(msg.text).toContain('confirmed');
  });
  it('renders a rejected message with reason', () => {
    const msg = renderCustomerTelegram(BOOKING_NOTIFICATION_TYPE.rejected, BOOKING, {
      reason: 'Fake proof',
    });
    expect(msg.text).toContain('Fake proof');
    expect(msg.text).toContain('rejected');
  });
  it('renders a rescheduled message with new time', () => {
    const msg = renderCustomerTelegram(BOOKING_NOTIFICATION_TYPE.rescheduled, BOOKING, {
      newStartAt: '2026-10-06T10:00:00.000Z',
    });
    expect(msg.text).toContain('rescheduled');
    expect(msg.text).toContain('13:00'); // 10:00Z + 3h
  });
  it('renders a 24h reminder', () => {
    const msg = renderCustomerTelegram(BOOKING_NOTIFICATION_TYPE.reminder24h, BOOKING, {});
    expect(msg.text).toContain('tomorrow');
  });
  it('renders a generic fallback for unknown types', () => {
    const msg = renderCustomerTelegram('UNKNOWN_TYPE', BOOKING, {});
    expect(msg.text).toContain('Test Salon');
  });
});

describe('renderOwnerAffectedEmail', () => {
  it('escapes all entries and renders Reschedule/Keep links', () => {
    const result = renderOwnerAffectedEmail(
      {
        entries: [
          {
            customerName: '<script>alert(1)</script>',
            customerPhone: '+251911000001',
            startAt: '2026-10-05T08:00:00Z',
            durationMinutes: 30,
            services: [{ name: 'Haircut', durationMinutes: 30 }],
            reason: 'Schedule changed',
            managementUrl: '/manage/#/businesses/b1/bookings/booking1',
          },
        ],
      },
      'Test Salon',
      { publicBaseUrl: 'https://example.com' },
    );
    expect(result.subject).toContain('1 booking');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('Reschedule');
    expect(result.html).toContain('Keep Booking');
    expect(result.html).toContain('https://example.com');
  });
  it('escapes multiple entries', () => {
    const result = renderOwnerAffectedEmail(
      {
        entries: [
          {
            startAt: '2026-10-05T08:00:00Z',
            managementUrl: '/manage/#/businesses/b1/bookings/booking1',
          },
          {
            startAt: '2026-10-05T09:00:00Z',
            managementUrl: '/manage/#/businesses/b1/bookings/booking2',
          },
        ],
      },
      'Salon',
      { publicBaseUrl: 'https://example.com' },
    );
    expect(result.subject).toContain('2 bookings');
  });
});
