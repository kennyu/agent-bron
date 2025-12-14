/**
 * Skill Registry
 *
 * Predefined skills that bundle tools, MCP servers, and subagents
 * into reusable configurations.
 */

import type {
  Skill,
  MergedSkillConfig,
  SkillResponse,
} from '../../../../packages/shared-types/src';

/**
 * Predefined skills registry
 */
export const SKILLS: Record<string, Skill> = {
  'code-reviewer': {
    name: 'code-reviewer',
    description: 'Reviews code for bugs, security, and best practices',
    prompt: 'You are a code review expert. Analyze code thoroughly.',
    tools: ['Read', 'Grep', 'Glob'],
    subagents: {
      'security-scanner': {
        description: 'Scans for security vulnerabilities',
        prompt: 'Focus on security issues: injection, auth, crypto.',
        tools: ['Read', 'Grep', 'Glob'],
        model: 'opus',
      },
    },
  },

  'file-editor': {
    name: 'file-editor',
    description: 'Creates and modifies files',
    prompt: 'You help create and edit files efficiently.',
    tools: ['Read', 'Write', 'Edit', 'Glob'],
  },

  'code-runner': {
    name: 'code-runner',
    description: 'Executes scripts, tests, and build commands',
    prompt: 'You run scripts and commands. Report results clearly.',
    tools: ['Bash', 'Read', 'Grep'],
    subagents: {
      'test-runner': {
        description: 'Runs test suites and analyzes results',
        prompt: 'Run tests and provide clear pass/fail analysis.',
        tools: ['Bash', 'Read'],
        model: 'haiku',
      },
    },
  },

  researcher: {
    name: 'researcher',
    description: 'Searches the web and fetches documentation',
    prompt: 'You research topics and summarize findings.',
    tools: ['WebSearch', 'WebFetch', 'Read'],
  },

  'email-assistant': {
    name: 'email-assistant',
    description: 'Manages email via Gmail integration',
    prompt: 'You help manage email. Read, search, and compose messages.',
    tools: ['Read'],
    mcpServers: {
      gmail: { command: 'npx', args: ['@anthropic/gmail-mcp'] },
    },
  },
};

/**
 * Get a skill by name
 */
export function getSkill(name: string): Skill | undefined {
  return SKILLS[name];
}

/**
 * Get all available skills
 */
export function getAllSkills(): Skill[] {
  return Object.values(SKILLS);
}

/**
 * Convert a skill to API response format
 */
export function skillToResponse(skill: Skill): SkillResponse {
  return {
    name: skill.name,
    description: skill.description,
    tools: skill.tools || [],
    hasMcpServers: Object.keys(skill.mcpServers || {}).length > 0,
    hasSubagents: Object.keys(skill.subagents || {}).length > 0,
  };
}

/**
 * Merge multiple skills into a single configuration
 */
export function mergeSkills(skills: Skill[]): MergedSkillConfig {
  const allTools: string[] = [];
  const allMcpServers: MergedSkillConfig['mcpServers'] = {};
  const allSubagents: MergedSkillConfig['subagents'] = {};
  const prompts: string[] = [];

  for (const skill of skills) {
    // Collect tools
    if (skill.tools) {
      allTools.push(...skill.tools);
    }

    // Merge MCP servers
    if (skill.mcpServers) {
      Object.assign(allMcpServers, skill.mcpServers);
    }

    // Merge subagents
    if (skill.subagents) {
      Object.assign(allSubagents, skill.subagents);
    }

    // Collect prompts
    if (skill.prompt) {
      prompts.push(skill.prompt);
    }
  }

  return {
    tools: [...new Set(allTools)], // Deduplicate tools
    mcpServers: allMcpServers,
    subagents: allSubagents,
    systemPromptAdditions: prompts.join('\n\n'),
  };
}
