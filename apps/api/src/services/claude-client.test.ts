/**
 * Claude Client Unit Tests
 *
 * Tests for skill resolution and query options building.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

// We need to test the private buildQueryOptions method, so we'll test
// by observing the behavior through the public interface. However,
// since the actual SDK call is difficult to mock, we'll create a
// testable version that exposes the internal logic.

// Import the skills for verification
import { SKILLS, mergeSkills, getSkill } from '../config/skills';
import type { UserMCPConfig } from '../../../../packages/shared-types/src';

describe('claude-client skill resolution', () => {
  // Helper function that mimics buildQueryOptions logic for testing
  function buildTestQueryOptions(options: {
    prompt: string;
    systemPrompt?: string;
    mcpConfig?: UserMCPConfig;
    allowedTools?: string[];
    skills?: string[];
  }) {
    const defaultAllowedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

    // Convert MCP config to SDK format
    if (options.mcpConfig?.servers && Array.isArray(options.mcpConfig.servers)) {
      for (const server of options.mcpConfig.servers) {
        if (server.serverPath) {
          mcpServers[server.provider] = {
            command: server.serverPath,
            args: server.args || [],
          };
        }
      }
    }

    // Load and merge requested skills
    const activeSkills = (options.skills || [])
      .map((name) => getSkill(name))
      .filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);

    const merged = mergeSkills(activeSkills);

    // Merge skill tools with explicit allowedTools
    const allTools = [
      ...(options.allowedTools || defaultAllowedTools),
      ...merged.tools,
    ];

    // Merge skill MCP servers with user's MCP config
    for (const [name, config] of Object.entries(merged.mcpServers)) {
      mcpServers[name] = {
        command: config.command,
        args: config.args || [],
        ...(config.env && { env: config.env }),
      };
    }

    // Build system prompt with skill additions
    let systemPrompt: string | undefined;
    if (!options.systemPrompt && !merged.systemPromptAdditions) {
      systemPrompt = undefined;
    } else if (!merged.systemPromptAdditions) {
      systemPrompt = options.systemPrompt;
    } else if (!options.systemPrompt) {
      systemPrompt = merged.systemPromptAdditions;
    } else {
      systemPrompt = `${options.systemPrompt}\n\n${merged.systemPromptAdditions}`;
    }

    return {
      prompt: options.prompt,
      allowedTools: [...new Set(allTools)],
      agents: Object.keys(merged.subagents).length > 0 ? merged.subagents : undefined,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      systemPrompt,
    };
  }

  describe('skill resolution', () => {
    test('builds options without skills', () => {
      const result = buildTestQueryOptions({
        prompt: 'Hello',
      });

      expect(result.prompt).toBe('Hello');
      expect(result.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
      expect(result.agents).toBeUndefined();
      expect(result.mcpServers).toBeUndefined();
    });

    test('merges skill tools with default tools', () => {
      const result = buildTestQueryOptions({
        prompt: 'Review this code',
        skills: ['code-reviewer'],
      });

      // Should have default tools plus skill tools
      expect(result.allowedTools).toContain('Read');
      expect(result.allowedTools).toContain('Write');
      expect(result.allowedTools).toContain('Grep');
      expect(result.allowedTools).toContain('Glob');
    });

    test('merges skill tools with explicit allowedTools', () => {
      const result = buildTestQueryOptions({
        prompt: 'Review this code',
        allowedTools: ['Read'],
        skills: ['code-runner'],
      });

      // Should have explicit tools plus skill tools
      expect(result.allowedTools).toContain('Read');
      expect(result.allowedTools).toContain('Bash');
      expect(result.allowedTools).toContain('Grep');
    });

    test('deduplicates tools', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        allowedTools: ['Read', 'Grep'],
        skills: ['code-reviewer'], // Also has Read and Grep
      });

      const readCount = result.allowedTools.filter((t: string) => t === 'Read').length;
      const grepCount = result.allowedTools.filter((t: string) => t === 'Grep').length;

      expect(readCount).toBe(1);
      expect(grepCount).toBe(1);
    });

    test('includes subagents from skills', () => {
      const result = buildTestQueryOptions({
        prompt: 'Review and run tests',
        skills: ['code-reviewer', 'code-runner'],
      });

      expect(result.agents).toBeDefined();
      expect(result.agents).toHaveProperty('security-scanner');
      expect(result.agents).toHaveProperty('test-runner');
    });

    test('includes MCP servers from skills', () => {
      const result = buildTestQueryOptions({
        prompt: 'Check my email',
        skills: ['email-assistant'],
      });

      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers).toHaveProperty('gmail');
      expect(result.mcpServers?.gmail.command).toBe('npx');
    });

    test('merges user MCP config with skill MCP servers', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        mcpConfig: {
          servers: [
            { provider: 'custom', serverPath: '/path/to/custom', args: ['--arg'] },
          ],
        },
        skills: ['email-assistant'],
      });

      expect(result.mcpServers).toHaveProperty('custom');
      expect(result.mcpServers).toHaveProperty('gmail');
      expect(result.mcpServers?.custom.command).toBe('/path/to/custom');
    });

    test('appends skill prompts to system prompt', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        systemPrompt: 'Base system prompt',
        skills: ['code-reviewer'],
      });

      expect(result.systemPrompt).toContain('Base system prompt');
      expect(result.systemPrompt).toContain('You are a code review expert');
    });

    test('sets system prompt from skills when no base prompt', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        skills: ['researcher'],
      });

      expect(result.systemPrompt).toBe('You research topics and summarize findings.');
    });

    test('ignores invalid skill names', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        skills: ['nonexistent-skill', 'code-reviewer', 'another-fake'],
      });

      // Should only have code-reviewer's configuration
      expect(result.allowedTools).toContain('Grep');
      expect(result.agents).toHaveProperty('security-scanner');
      // Should not have any tools from nonexistent skills
    });

    test('handles empty skills array', () => {
      const result = buildTestQueryOptions({
        prompt: 'Test',
        skills: [],
      });

      expect(result.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
      expect(result.agents).toBeUndefined();
      expect(result.mcpServers).toBeUndefined();
    });

    test('merges multiple skills correctly', () => {
      const result = buildTestQueryOptions({
        prompt: 'Review, edit, and run tests',
        skills: ['code-reviewer', 'file-editor', 'code-runner'],
      });

      // Tools from all three skills
      expect(result.allowedTools).toContain('Read');
      expect(result.allowedTools).toContain('Write');
      expect(result.allowedTools).toContain('Edit');
      expect(result.allowedTools).toContain('Bash');
      expect(result.allowedTools).toContain('Grep');
      expect(result.allowedTools).toContain('Glob');

      // Subagents from code-reviewer and code-runner
      expect(result.agents).toHaveProperty('security-scanner');
      expect(result.agents).toHaveProperty('test-runner');

      // Combined system prompts
      expect(result.systemPrompt).toContain('code review expert');
      expect(result.systemPrompt).toContain('create and edit files');
      expect(result.systemPrompt).toContain('run scripts and commands');
    });
  });
});
