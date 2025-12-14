/**
 * Skills API Route Tests
 *
 * Tests for the /skills endpoints.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { createSkillRoutes } from './skills';
import { SKILLS } from '../config/skills';

describe('/skills API', () => {
  // Create a test app with the skills routes
  const app = new Hono();
  app.route('/skills', createSkillRoutes());

  describe('GET /skills', () => {
    test('returns list of all skills', async () => {
      const res = await app.request('/skills');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.skills).toBeDefined();
      expect(Array.isArray(data.skills)).toBe(true);
      expect(data.skills.length).toBeGreaterThanOrEqual(5);
    });

    test('returns skills in correct format', async () => {
      const res = await app.request('/skills');
      const data = await res.json();

      const skill = data.skills[0];
      expect(skill).toHaveProperty('name');
      expect(skill).toHaveProperty('description');
      expect(skill).toHaveProperty('tools');
      expect(skill).toHaveProperty('hasMcpServers');
      expect(skill).toHaveProperty('hasSubagents');
    });

    test('includes code-reviewer skill', async () => {
      const res = await app.request('/skills');
      const data = await res.json();

      const codeReviewer = data.skills.find((s: any) => s.name === 'code-reviewer');
      expect(codeReviewer).toBeDefined();
      expect(codeReviewer.description).toBe('Reviews code for bugs, security, and best practices');
      expect(codeReviewer.tools).toContain('Read');
      expect(codeReviewer.hasSubagents).toBe(true);
    });

    test('includes email-assistant with MCP servers', async () => {
      const res = await app.request('/skills');
      const data = await res.json();

      const emailAssistant = data.skills.find((s: any) => s.name === 'email-assistant');
      expect(emailAssistant).toBeDefined();
      expect(emailAssistant.hasMcpServers).toBe(true);
    });
  });

  describe('GET /skills/:name', () => {
    test('returns specific skill details', async () => {
      const res = await app.request('/skills/code-reviewer');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.skill).toBeDefined();
      expect(data.skill.name).toBe('code-reviewer');
      expect(data.skill.description).toBe('Reviews code for bugs, security, and best practices');
    });

    test('returns 404 for nonexistent skill', async () => {
      const res = await app.request('/skills/nonexistent-skill');

      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Skill not found');
    });

    test('returns code-runner with correct tools', async () => {
      const res = await app.request('/skills/code-runner');
      const data = await res.json();

      expect(data.skill.tools).toContain('Bash');
      expect(data.skill.tools).toContain('Read');
      expect(data.skill.hasSubagents).toBe(true);
    });

    test('returns researcher with correct tools', async () => {
      const res = await app.request('/skills/researcher');
      const data = await res.json();

      expect(data.skill.tools).toContain('WebSearch');
      expect(data.skill.tools).toContain('WebFetch');
      expect(data.skill.hasMcpServers).toBe(false);
      expect(data.skill.hasSubagents).toBe(false);
    });

    test('returns file-editor with correct tools', async () => {
      const res = await app.request('/skills/file-editor');
      const data = await res.json();

      expect(data.skill.tools).toContain('Read');
      expect(data.skill.tools).toContain('Write');
      expect(data.skill.tools).toContain('Edit');
      expect(data.skill.hasSubagents).toBe(false);
    });

    test('returns email-assistant with MCP server indicator', async () => {
      const res = await app.request('/skills/email-assistant');
      const data = await res.json();

      expect(data.skill.hasMcpServers).toBe(true);
    });
  });
});
