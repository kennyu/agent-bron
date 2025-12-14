/**
 * Skills API Routes
 *
 * Exposes available skills for the Claude agent.
 */

import { Hono } from 'hono';
import { getAllSkills, getSkill, skillToResponse } from '../config/skills';

/**
 * Create skills routes
 */
export function createSkillRoutes(): Hono {
  const app = new Hono();

  /**
   * GET /skills - List all available skills
   */
  app.get('/', (c) => {
    const skills = getAllSkills();
    return c.json({
      skills: skills.map(skillToResponse),
    });
  });

  /**
   * GET /skills/:name - Get a specific skill's details
   */
  app.get('/:name', (c) => {
    const name = c.req.param('name');
    const skill = getSkill(name);

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    return c.json({
      skill: skillToResponse(skill),
    });
  });

  return app;
}
