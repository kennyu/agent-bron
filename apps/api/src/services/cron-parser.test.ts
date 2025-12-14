/**
 * Cron Parser Unit Tests
 *
 * Tests for cron expression parsing and next run time calculation.
 */

import { describe, test, expect } from 'bun:test';
import {
  getNextRunTime,
  isValidCronExpression,
  describeCronExpression,
} from './cron-parser';

describe('cron-parser', () => {
  describe('isValidCronExpression', () => {
    test('accepts valid 5-field cron expressions', () => {
      expect(isValidCronExpression('* * * * *')).toBe(true);
      expect(isValidCronExpression('*/5 * * * *')).toBe(true);
      expect(isValidCronExpression('0 9 * * 1-5')).toBe(true);
      expect(isValidCronExpression('0 0 1 * *')).toBe(true);
      expect(isValidCronExpression('30 14 * * *')).toBe(true);
      expect(isValidCronExpression('0,30 * * * *')).toBe(true);
      expect(isValidCronExpression('0-30/5 * * * *')).toBe(true);
    });

    test('rejects invalid cron expressions', () => {
      expect(isValidCronExpression('')).toBe(false);
      expect(isValidCronExpression('* * *')).toBe(false); // Too few fields
      expect(isValidCronExpression('* * * * * *')).toBe(false); // Too many fields
      expect(isValidCronExpression('invalid')).toBe(false);
    });
  });

  describe('getNextRunTime', () => {
    // Use a fixed date for predictable testing
    const baseDate = new Date('2024-06-15T10:30:00.000Z');

    test('every minute returns next minute', () => {
      const result = getNextRunTime('* * * * *', baseDate);
      expect(result.getMinutes()).toBe(31);
      expect(result.getHours()).toBe(10);
    });

    test('every 5 minutes', () => {
      const result = getNextRunTime('*/5 * * * *', baseDate);
      // Next 5-minute mark after 10:30 is 10:35
      expect(result.getMinutes()).toBe(35);
    });

    test('specific minute of every hour', () => {
      const result = getNextRunTime('0 * * * *', baseDate);
      // At 10:30 UTC, next :00 is 11:00 UTC
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCHours()).toBe(11);
    });

    test('specific hour of every day', () => {
      const result = getNextRunTime('0 9 * * *', baseDate);
      // At 10:30 on June 15, next 9:00 is June 16 at 9:00
      expect(result.getMinutes()).toBe(0);
      expect(result.getHours()).toBe(9);
      expect(result.getDate()).toBe(16);
    });

    test('weekday only (Mon-Fri)', () => {
      // June 15, 2024 is a Saturday
      const result = getNextRunTime('0 9 * * 1-5', baseDate);
      // Next weekday is Monday, June 17
      expect(result.getDay()).toBeGreaterThanOrEqual(1);
      expect(result.getDay()).toBeLessThanOrEqual(5);
    });

    test('specific day of month', () => {
      const result = getNextRunTime('0 0 1 * *', baseDate);
      // At June 15, next 1st is July 1
      expect(result.getDate()).toBe(1);
      expect(result.getMonth()).toBe(6); // July (0-indexed)
    });

    test('comma-separated values', () => {
      const result = getNextRunTime('0,30 * * * *', baseDate);
      // At 10:30, starting from next minute (10:31), next valid is 11:00 (0)
      expect([0, 30]).toContain(result.getUTCMinutes());
    });

    test('range with step', () => {
      const result = getNextRunTime('0-30/10 * * * *', baseDate);
      // Values are 0, 10, 20, 30. At 10:30, next minute is 10:31
      // But 31 is not in the range, so next is 11:00
      expect([0, 10, 20, 30]).toContain(result.getUTCMinutes());
    });

    test('handles year rollover', () => {
      const decemberDate = new Date('2024-12-31T23:59:00.000Z');
      const result = getNextRunTime('0 0 1 1 *', decemberDate);
      // Next Jan 1 at 00:00 is 2025
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(1);
    });

    test('handles month rollover', () => {
      const endOfMonth = new Date('2024-06-30T23:00:00.000Z');
      const result = getNextRunTime('0 0 * * *', endOfMonth);
      // Next midnight is July 1
      expect(result.getMonth()).toBe(6); // July
    });

    test('specific day of week (Sunday = 0)', () => {
      // June 15, 2024 is Saturday
      const result = getNextRunTime('0 9 * * 0', baseDate);
      // Next Sunday is June 16
      expect(result.getDay()).toBe(0);
    });

    test('multiple days of week', () => {
      const result = getNextRunTime('0 9 * * 1,3,5', baseDate);
      // Mon=1, Wed=3, Fri=5
      expect([1, 3, 5]).toContain(result.getDay());
    });
  });

  describe('describeCronExpression', () => {
    test('every minute', () => {
      const desc = describeCronExpression('* * * * *');
      expect(desc).toContain('every minute');
    });

    test('every 5 minutes', () => {
      const desc = describeCronExpression('*/5 * * * *');
      expect(desc).toContain('5 minutes');
    });

    test('specific hour', () => {
      const desc = describeCronExpression('0 9 * * *');
      expect(desc).toContain('9');
      expect(desc).toContain('AM');
    });

    test('PM hour', () => {
      const desc = describeCronExpression('0 14 * * *');
      expect(desc).toContain('2');
      expect(desc).toContain('PM');
    });

    test('weekday schedule', () => {
      const desc = describeCronExpression('0 9 * * 1-5');
      expect(desc).toContain('Mon');
      expect(desc).toContain('Fri');
    });

    test('specific day of month', () => {
      const desc = describeCronExpression('0 0 1 * *');
      expect(desc).toContain('day');
      expect(desc).toContain('1');
    });

    test('specific month', () => {
      const desc = describeCronExpression('0 0 1 1 *');
      expect(desc).toContain('Jan');
    });
  });

  describe('edge cases', () => {
    test('handles leap year February 29', () => {
      const leapYearFeb = new Date('2024-02-28T10:00:00.000Z');
      const result = getNextRunTime('0 0 29 2 *', leapYearFeb);
      // 2024 is a leap year, so Feb 29 exists
      expect(result.getDate()).toBe(29);
      expect(result.getMonth()).toBe(1); // February
    });

    test('handles non-leap year February', () => {
      const nonLeapYearFeb = new Date('2025-02-01T10:00:00.000Z');
      const result = getNextRunTime('0 0 28 2 *', nonLeapYearFeb);
      // Feb 28 exists in non-leap year
      expect(result.getDate()).toBe(28);
    });

    test('all wildcards returns next minute', () => {
      const date = new Date('2024-06-15T10:30:45.000Z');
      const result = getNextRunTime('* * * * *', date);
      // Should reset seconds and add 1 minute
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
      expect(result.getMinutes()).toBe(31);
    });

    test('multiple constraints work together', () => {
      // 9 AM on first Monday of the month
      const result = getNextRunTime('0 9 1-7 * 1', new Date('2024-06-01T10:00:00.000Z'));
      // Should find a day 1-7 that's also a Monday at 9 AM
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(0);
      expect(result.getDay()).toBe(1); // Monday
      expect(result.getDate()).toBeLessThanOrEqual(7);
    });
  });
});
