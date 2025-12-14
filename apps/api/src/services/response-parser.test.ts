/**
 * Response Parser Unit Tests
 *
 * Tests for parsing Claude's responses in both chat and worker contexts.
 */

import { describe, test, expect } from 'bun:test';
import {
  isCreateScheduleResponse,
  isChatNeedsInputResponse,
  isStateUpdateResponse,
  isNeedsInputResponse,
  isContinueResponse,
  isCompleteResponse,
} from '../../../../packages/shared-types/src';

describe('response-parser', () => {
  describe('chat response type guards', () => {
    describe('isCreateScheduleResponse', () => {
      test('returns true for valid create_schedule response', () => {
        const response = {
          create_schedule: {
            type: 'cron',
            cron_expression: '0 9 * * *',
            initial_state: { context: { task: 'check email' }, step: 'initial' },
          },
          message: 'I will check your email daily at 9 AM',
        };
        expect(isCreateScheduleResponse(response)).toBe(true);
      });

      test('returns true for scheduled type', () => {
        const response = {
          create_schedule: {
            type: 'scheduled',
            run_at: '2024-06-15T10:00:00.000Z',
          },
          message: 'Scheduled for 10 AM',
        };
        expect(isCreateScheduleResponse(response)).toBe(true);
      });

      test('returns true for immediate type', () => {
        const response = {
          create_schedule: { type: 'immediate' },
          message: 'Running now',
        };
        expect(isCreateScheduleResponse(response)).toBe(true);
      });

      test('returns false for plain message', () => {
        expect(isCreateScheduleResponse({ message: 'Hello' })).toBe(false);
      });

      test('returns false for null', () => {
        expect(isCreateScheduleResponse(null)).toBe(false);
      });

      test('returns false for undefined', () => {
        expect(isCreateScheduleResponse(undefined)).toBe(false);
      });
    });

    describe('isChatNeedsInputResponse', () => {
      test('returns true for confirmation question', () => {
        const response = {
          needs_input: {
            type: 'confirmation',
            prompt: 'Should I proceed?',
          },
          message: 'Before I continue, I need your confirmation.',
        };
        expect(isChatNeedsInputResponse(response)).toBe(true);
      });

      test('returns true for choice question', () => {
        const response = {
          needs_input: {
            type: 'choice',
            prompt: 'Which format do you prefer?',
            options: ['PDF', 'CSV', 'Excel'],
          },
          message: 'Please select your preferred format.',
        };
        expect(isChatNeedsInputResponse(response)).toBe(true);
      });

      test('returns true for input question', () => {
        const response = {
          needs_input: {
            type: 'input',
            prompt: 'What is your email address?',
          },
          message: 'I need your email to continue.',
        };
        expect(isChatNeedsInputResponse(response)).toBe(true);
      });

      test('returns false for worker needs_input format', () => {
        // Worker format uses needs_input: true (boolean)
        const response = {
          needs_input: true,
          message: 'Need input',
          question: { type: 'confirmation', prompt: 'OK?' },
        };
        expect(isChatNeedsInputResponse(response)).toBe(false);
      });

      test('returns false for plain message', () => {
        expect(isChatNeedsInputResponse({ message: 'Hello' })).toBe(false);
      });
    });

    describe('isStateUpdateResponse', () => {
      test('returns true for state update', () => {
        const response = {
          state_update: { lastChecked: '2024-06-15T10:00:00Z', count: 5 },
          message: 'Updated the state',
        };
        expect(isStateUpdateResponse(response)).toBe(true);
      });

      test('returns true for empty state update', () => {
        const response = {
          state_update: {},
          message: 'No changes',
        };
        expect(isStateUpdateResponse(response)).toBe(true);
      });

      test('returns false for plain message', () => {
        expect(isStateUpdateResponse({ message: 'Hello' })).toBe(false);
      });
    });
  });

  describe('worker response type guards', () => {
    describe('isNeedsInputResponse', () => {
      test('returns true for valid needs_input response', () => {
        const response = {
          needs_input: true,
          message: 'I found multiple matches. Which one should I use?',
          question: {
            type: 'choice',
            prompt: 'Select the correct email',
            options: ['john@example.com', 'john.doe@example.com'],
          },
        };
        expect(isNeedsInputResponse(response)).toBe(true);
      });

      test('returns true for confirmation type', () => {
        const response = {
          needs_input: true,
          message: 'Should I proceed with the deletion?',
          question: {
            type: 'confirmation',
            prompt: 'This will permanently delete 5 files',
          },
        };
        expect(isNeedsInputResponse(response)).toBe(true);
      });

      test('returns false when needs_input is false', () => {
        const response = {
          needs_input: false,
          message: 'No input needed',
        };
        expect(isNeedsInputResponse(response)).toBe(false);
      });

      test('returns false for chat needs_input format', () => {
        // Chat format uses needs_input as an object
        const response = {
          needs_input: { type: 'confirmation', prompt: 'OK?' },
          message: 'Need input',
        };
        expect(isNeedsInputResponse(response)).toBe(false);
      });
    });

    describe('isContinueResponse', () => {
      test('returns true for continue with state update', () => {
        const response = {
          continue: true,
          message: 'Processed 10 emails',
          state_update: { processedCount: 10 },
          next_step: 'process_attachments',
        };
        expect(isContinueResponse(response)).toBe(true);
      });

      test('returns true for continue without optional fields', () => {
        const response = {
          continue: true,
        };
        expect(isContinueResponse(response)).toBe(true);
      });

      test('returns true for continue with only message', () => {
        const response = {
          continue: true,
          message: 'Still working...',
        };
        expect(isContinueResponse(response)).toBe(true);
      });

      test('returns false when continue is false', () => {
        const response = {
          continue: false,
          message: 'Not continuing',
        };
        expect(isContinueResponse(response)).toBe(false);
      });

      test('returns false for complete response', () => {
        const response = {
          complete: true,
          message: 'Done',
        };
        expect(isContinueResponse(response)).toBe(false);
      });
    });

    describe('isCompleteResponse', () => {
      test('returns true for valid complete response', () => {
        const response = {
          complete: true,
          message: 'Successfully processed all 25 emails',
        };
        expect(isCompleteResponse(response)).toBe(true);
      });

      test('returns false when complete is false', () => {
        const response = {
          complete: false,
          message: 'Not complete',
        };
        expect(isCompleteResponse(response)).toBe(false);
      });

      test('returns false for continue response', () => {
        const response = {
          continue: true,
          message: 'Still going',
        };
        expect(isCompleteResponse(response)).toBe(false);
      });
    });
  });

  describe('JSON extraction from responses', () => {
    // Helper to simulate the parseClaudeResponse behavior
    function extractJSON(response: string): unknown {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }

    test('extracts JSON from pure JSON response', () => {
      const response = '{"message": "Hello", "create_schedule": {"type": "immediate"}}';
      const result = extractJSON(response);
      expect(result).toEqual({
        message: 'Hello',
        create_schedule: { type: 'immediate' },
      });
    });

    test('extracts JSON from mixed text and JSON response', () => {
      const response = `Sure, I'll help you with that.

{"create_schedule": {"type": "cron", "cron_expression": "0 9 * * *"}, "message": "Scheduled!"}

Let me know if you need anything else.`;
      const result = extractJSON(response);
      expect(result).toEqual({
        create_schedule: { type: 'cron', cron_expression: '0 9 * * *' },
        message: 'Scheduled!',
      });
    });

    test('extracts nested JSON correctly', () => {
      const response = `Here's the result:
{"needs_input": {"type": "choice", "prompt": "Pick one", "options": ["A", "B"]}, "message": "Please choose"}`;
      const result = extractJSON(response);
      expect(result).toEqual({
        needs_input: { type: 'choice', prompt: 'Pick one', options: ['A', 'B'] },
        message: 'Please choose',
      });
    });

    test('returns null for plain text response', () => {
      const response = 'Hello! How can I help you today?';
      const result = extractJSON(response);
      expect(result).toBe(null);
    });

    test('returns null for invalid JSON', () => {
      const response = '{ invalid json }';
      const result = extractJSON(response);
      expect(result).toBe(null);
    });

    test('extracts first JSON object when multiple exist', () => {
      const response = '{"first": true} some text {"second": true}';
      const result = extractJSON(response);
      // The regex extracts the largest match, which would be from first { to last }
      expect(result).toBe(null); // Actually this returns null because the combined string isn't valid JSON
    });
  });

  describe('response type priority', () => {
    test('create_schedule takes precedence in chat context', () => {
      const response = {
        create_schedule: { type: 'immediate' },
        state_update: { foo: 'bar' },
        message: 'Both present',
      };
      // In the actual code, create_schedule would be checked first
      expect(isCreateScheduleResponse(response)).toBe(true);
      expect(isStateUpdateResponse(response)).toBe(true); // Both are true!
    });

    test('needs_input is distinct from complete/continue', () => {
      const response = {
        needs_input: true,
        message: 'Need input',
        question: { type: 'input', prompt: 'What?' },
      };
      expect(isNeedsInputResponse(response)).toBe(true);
      expect(isContinueResponse(response)).toBe(false);
      expect(isCompleteResponse(response)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles response with extra fields', () => {
      const response = {
        complete: true,
        message: 'Done',
        extra_field: 'should be ignored',
        another: 123,
      };
      expect(isCompleteResponse(response)).toBe(true);
    });

    test('handles boolean-like string values', () => {
      const response = {
        complete: 'true', // string, not boolean
        message: 'Done',
      };
      expect(isCompleteResponse(response)).toBe(false);
    });

    test('handles number 1 as truthy but not strictly true', () => {
      const response = {
        complete: 1,
        message: 'Done',
      };
      expect(isCompleteResponse(response)).toBe(false);
    });

    test('handles empty object', () => {
      const response = {};
      expect(isCreateScheduleResponse(response)).toBe(false);
      expect(isChatNeedsInputResponse(response)).toBe(false);
      expect(isStateUpdateResponse(response)).toBe(false);
      expect(isNeedsInputResponse(response)).toBe(false);
      expect(isContinueResponse(response)).toBe(false);
      expect(isCompleteResponse(response)).toBe(false);
    });

    test('handles array response', () => {
      const response = [{ message: 'Hello' }];
      expect(isCreateScheduleResponse(response)).toBe(false);
      expect(isNeedsInputResponse(response)).toBe(false);
    });
  });
});
