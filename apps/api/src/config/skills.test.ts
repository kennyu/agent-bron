/**
 * Skills Unit Tests
 *
 * Tests for skill registry and merging logic.
 */

import { describe, test, expect } from 'bun:test';
import {
  SKILLS,
  getSkill,
  getAllSkills,
  mergeSkills,
  skillToResponse,
} from './skills';
import type { Skill } from '../../../../packages/shared-types/src';

describe('skills', () => {
  describe('SKILLS registry', () => {
    test('contains expected predefined skills', () => {
      expect(SKILLS['code-reviewer']).toBeDefined();
      expect(SKILLS['file-editor']).toBeDefined();
      expect(SKILLS['code-runner']).toBeDefined();
      expect(SKILLS['researcher']).toBeDefined();
      expect(SKILLS['email-assistant']).toBeDefined();
    });

    test('code-reviewer has correct structure', () => {
      const skill = SKILLS['code-reviewer'];
      expect(skill.name).toBe('code-reviewer');
      expect(skill.description).toBe('Reviews code for bugs, security, and best practices');
      expect(skill.tools).toContain('Read');
      expect(skill.tools).toContain('Grep');
      expect(skill.tools).toContain('Glob');
      expect(skill.subagents?.['security-scanner']).toBeDefined();
    });

    test('email-assistant has MCP server configuration', () => {
      const skill = SKILLS['email-assistant'];
      expect(skill.mcpServers?.['gmail']).toBeDefined();
      expect(skill.mcpServers?.['gmail'].command).toBe('npx');
      expect(skill.mcpServers?.['gmail'].args).toContain('@anthropic/gmail-mcp');
    });
  });

  describe('getSkill', () => {
    test('returns skill for valid name', () => {
      const skill = getSkill('code-reviewer');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('code-reviewer');
    });

    test('returns undefined for invalid name', () => {
      const skill = getSkill('nonexistent-skill');
      expect(skill).toBeUndefined();
    });

    test('returns undefined for empty string', () => {
      const skill = getSkill('');
      expect(skill).toBeUndefined();
    });
  });

  describe('getAllSkills', () => {
    test('returns all skills as array', () => {
      const skills = getAllSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThanOrEqual(5);
    });

    test('includes all predefined skills', () => {
      const skills = getAllSkills();
      const names = skills.map((s) => s.name);
      expect(names).toContain('code-reviewer');
      expect(names).toContain('file-editor');
      expect(names).toContain('code-runner');
      expect(names).toContain('researcher');
      expect(names).toContain('email-assistant');
    });
  });

  describe('skillToResponse', () => {
    test('converts skill to response format', () => {
      const skill = SKILLS['code-reviewer'];
      const response = skillToResponse(skill);

      expect(response.name).toBe('code-reviewer');
      expect(response.description).toBe('Reviews code for bugs, security, and best practices');
      expect(response.tools).toEqual(['Read', 'Grep', 'Glob']);
      expect(response.hasMcpServers).toBe(false);
      expect(response.hasSubagents).toBe(true);
    });

    test('detects MCP servers presence', () => {
      const skill = SKILLS['email-assistant'];
      const response = skillToResponse(skill);

      expect(response.hasMcpServers).toBe(true);
    });

    test('handles skill without tools', () => {
      const skill: Skill = {
        name: 'test-skill',
        description: 'Test',
        prompt: 'Test prompt',
      };
      const response = skillToResponse(skill);

      expect(response.tools).toEqual([]);
      expect(response.hasMcpServers).toBe(false);
      expect(response.hasSubagents).toBe(false);
    });
  });

  describe('mergeSkills', () => {
    test('returns empty config for empty array', () => {
      const merged = mergeSkills([]);

      expect(merged.tools).toEqual([]);
      expect(merged.mcpServers).toEqual({});
      expect(merged.subagents).toEqual({});
      expect(merged.systemPromptAdditions).toBe('');
    });

    test('merges single skill correctly', () => {
      const skill = SKILLS['code-reviewer'];
      const merged = mergeSkills([skill]);

      expect(merged.tools).toEqual(['Read', 'Grep', 'Glob']);
      expect(merged.subagents).toHaveProperty('security-scanner');
      expect(merged.systemPromptAdditions).toBe(skill.prompt);
    });

    test('merges multiple skills and deduplicates tools', () => {
      const codeReviewer = SKILLS['code-reviewer'];
      const codeRunner = SKILLS['code-runner'];
      const merged = mergeSkills([codeReviewer, codeRunner]);

      // Should contain tools from both skills, deduplicated
      expect(merged.tools).toContain('Read');
      expect(merged.tools).toContain('Grep');
      expect(merged.tools).toContain('Glob');
      expect(merged.tools).toContain('Bash');

      // Read and Grep appear in both, should only appear once
      const readCount = merged.tools.filter((t) => t === 'Read').length;
      expect(readCount).toBe(1);
    });

    test('merges subagents from multiple skills', () => {
      const codeReviewer = SKILLS['code-reviewer'];
      const codeRunner = SKILLS['code-runner'];
      const merged = mergeSkills([codeReviewer, codeRunner]);

      expect(merged.subagents).toHaveProperty('security-scanner');
      expect(merged.subagents).toHaveProperty('test-runner');
    });

    test('merges MCP servers', () => {
      const emailAssistant = SKILLS['email-assistant'];
      const researcher = SKILLS['researcher'];
      const merged = mergeSkills([emailAssistant, researcher]);

      expect(merged.mcpServers).toHaveProperty('gmail');
      expect(merged.mcpServers.gmail.command).toBe('npx');
    });

    test('concatenates system prompts', () => {
      const skill1: Skill = {
        name: 'skill1',
        description: 'First',
        prompt: 'First prompt',
        tools: ['Read'],
      };
      const skill2: Skill = {
        name: 'skill2',
        description: 'Second',
        prompt: 'Second prompt',
        tools: ['Write'],
      };
      const merged = mergeSkills([skill1, skill2]);

      expect(merged.systemPromptAdditions).toBe('First prompt\n\nSecond prompt');
    });

    test('handles skills with conflicting MCP server names', () => {
      const skill1: Skill = {
        name: 'skill1',
        description: 'First',
        prompt: 'First',
        mcpServers: {
          shared: { command: 'command1', args: ['arg1'] },
        },
      };
      const skill2: Skill = {
        name: 'skill2',
        description: 'Second',
        prompt: 'Second',
        mcpServers: {
          shared: { command: 'command2', args: ['arg2'] },
        },
      };
      const merged = mergeSkills([skill1, skill2]);

      // Later skill's config should override
      expect(merged.mcpServers.shared.command).toBe('command2');
    });

    test('handles skills with conflicting subagent names', () => {
      const skill1: Skill = {
        name: 'skill1',
        description: 'First',
        prompt: 'First',
        subagents: {
          helper: { description: 'Helper 1', prompt: 'Prompt 1' },
        },
      };
      const skill2: Skill = {
        name: 'skill2',
        description: 'Second',
        prompt: 'Second',
        subagents: {
          helper: { description: 'Helper 2', prompt: 'Prompt 2' },
        },
      };
      const merged = mergeSkills([skill1, skill2]);

      // Later skill's subagent should override
      expect(merged.subagents.helper.description).toBe('Helper 2');
    });

    test('preserves tool order after deduplication', () => {
      const skill1: Skill = {
        name: 'skill1',
        description: 'First',
        prompt: 'First',
        tools: ['Read', 'Write', 'Edit'],
      };
      const skill2: Skill = {
        name: 'skill2',
        description: 'Second',
        prompt: 'Second',
        tools: ['Bash', 'Read', 'Grep'],
      };
      const merged = mergeSkills([skill1, skill2]);

      // First occurrence of each tool is preserved
      expect(merged.tools.indexOf('Read')).toBeLessThan(merged.tools.indexOf('Bash'));
    });
  });
});
