// Cron expression parser utility
//
// Parses cron expressions and calculates the next run time.
// Supports standard 5-field cron format: minute hour day month weekday
//
// Examples:
//   "* * * * *"      -> Every minute
//   "*/5 * * * *"    -> Every 5 minutes
//   "0 * * * *"      -> Every hour at minute 0
//   "0 9 * * 1-5"    -> 9 AM on weekdays
//   "0 0 1 * *"      -> First day of every month

interface CronField {
  values: number[];
  min: number;
  max: number;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/**
 * Parse a single cron field into an array of valid values
 */
function parseCronField(
  field: string,
  min: number,
  max: number
): CronField {
  const values: Set<number> = new Set();

  // Handle comma-separated values
  const parts = field.split(',');

  for (const part of parts) {
    // Handle step values (e.g., */5, 0-30/5)
    const [rangeOrValue, step] = part.split('/');
    const stepNum = step ? parseInt(step, 10) : 1;

    if (rangeOrValue === '*') {
      // All values with optional step
      for (let i = min; i <= max; i += stepNum) {
        values.add(i);
      }
    } else if (rangeOrValue.includes('-')) {
      // Range (e.g., 1-5, 0-30)
      const [start, end] = rangeOrValue.split('-').map((n) => parseInt(n, 10));
      for (let i = start; i <= end; i += stepNum) {
        if (i >= min && i <= max) {
          values.add(i);
        }
      }
    } else {
      // Single value
      const num = parseInt(rangeOrValue, 10);
      if (num >= min && num <= max) {
        values.add(num);
      }
    }
  }

  return {
    values: Array.from(values).sort((a, b) => a - b),
    min,
    max,
  };
}

/**
 * Parse a cron expression into its component fields
 */
function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${fields.length}`
    );
  }

  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 6), // 0 = Sunday
  };
}

/**
 * Find the next value in a sorted array that is >= target
 * Returns [value, wrapped] where wrapped is true if we had to wrap around
 */
function findNextValue(
  values: number[],
  target: number
): [number, boolean] {
  for (const value of values) {
    if (value >= target) {
      return [value, false];
    }
  }
  // Wrap around to first value
  return [values[0], true];
}

/**
 * Calculate the next run time from a cron expression
 */
export function getNextRunTime(
  cronExpression: string,
  from: Date = new Date()
): Date {
  const cron = parseCronExpression(cronExpression);

  // Start from the next minute
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Maximum iterations to prevent infinite loops
  const maxIterations = 366 * 24 * 60; // One year of minutes
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Check month
    const [nextMonth, monthWrapped] = findNextValue(
      cron.month.values,
      next.getMonth() + 1
    );
    if (monthWrapped || nextMonth !== next.getMonth() + 1) {
      if (monthWrapped) {
        next.setFullYear(next.getFullYear() + 1);
      }
      next.setMonth(nextMonth - 1);
      next.setDate(1);
      next.setHours(0);
      next.setMinutes(0);
      continue;
    }

    // Check day of month
    const [nextDay, dayWrapped] = findNextValue(
      cron.dayOfMonth.values,
      next.getDate()
    );
    if (dayWrapped || nextDay !== next.getDate()) {
      if (dayWrapped) {
        next.setMonth(next.getMonth() + 1);
      }
      next.setDate(nextDay);
      next.setHours(0);
      next.setMinutes(0);
      continue;
    }

    // Check day of week
    const currentDayOfWeek = next.getDay();
    if (!cron.dayOfWeek.values.includes(currentDayOfWeek)) {
      // Find next valid day of week
      let daysToAdd = 1;
      for (let i = 1; i <= 7; i++) {
        if (cron.dayOfWeek.values.includes((currentDayOfWeek + i) % 7)) {
          daysToAdd = i;
          break;
        }
      }
      next.setDate(next.getDate() + daysToAdd);
      next.setHours(0);
      next.setMinutes(0);
      continue;
    }

    // Check hour
    const [nextHour, hourWrapped] = findNextValue(
      cron.hour.values,
      next.getHours()
    );
    if (hourWrapped || nextHour !== next.getHours()) {
      if (hourWrapped) {
        next.setDate(next.getDate() + 1);
      }
      next.setHours(nextHour);
      next.setMinutes(0);
      continue;
    }

    // Check minute
    const [nextMinute, minuteWrapped] = findNextValue(
      cron.minute.values,
      next.getMinutes()
    );
    if (minuteWrapped) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(0);
      continue;
    }

    // All fields match
    next.setMinutes(nextMinute);
    return next;
  }

  throw new Error('Could not calculate next run time within reasonable bounds');
}

/**
 * Validate a cron expression
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a human-readable description of a cron expression
 */
export function describeCronExpression(expression: string): string {
  const cron = parseCronExpression(expression);

  const parts: string[] = [];

  // Minute
  if (cron.minute.values.length === 60) {
    parts.push('every minute');
  } else if (cron.minute.values.length === 1 && cron.minute.values[0] === 0) {
    // At the top of the hour
  } else if (cron.minute.values.length === 1) {
    parts.push(`at minute ${cron.minute.values[0]}`);
  } else {
    // Check for step pattern
    const diffs = cron.minute.values
      .slice(1)
      .map((v, i) => v - cron.minute.values[i]);
    if (diffs.every((d) => d === diffs[0])) {
      parts.push(`every ${diffs[0]} minutes`);
    } else {
      parts.push(`at minutes ${cron.minute.values.join(', ')}`);
    }
  }

  // Hour
  if (cron.hour.values.length === 24) {
    // Every hour - don't add
  } else if (cron.hour.values.length === 1) {
    const hour = cron.hour.values[0];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    parts.push(`at ${hour12} ${ampm}`);
  } else {
    parts.push(`at hours ${cron.hour.values.join(', ')}`);
  }

  // Day of week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (cron.dayOfWeek.values.length < 7) {
    const days = cron.dayOfWeek.values.map((d) => dayNames[d]);
    parts.push(`on ${days.join(', ')}`);
  }

  // Day of month
  if (cron.dayOfMonth.values.length < 31) {
    parts.push(`on day(s) ${cron.dayOfMonth.values.join(', ')}`);
  }

  // Month
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  if (cron.month.values.length < 12) {
    const months = cron.month.values.map((m) => monthNames[m - 1]);
    parts.push(`in ${months.join(', ')}`);
  }

  return parts.join(' ') || 'every minute';
}
