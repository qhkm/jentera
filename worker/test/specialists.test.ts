import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPECIALISTS,
  specialistProfileForRequest,
  specialistRunInstructions,
} from '../src/specialists';

const specialists = DEFAULT_SPECIALISTS.map((specialist) => ({
  ...specialist,
  id: specialist.profile,
  instructions: '',
  enabled: true,
}));

describe('the private per-business specialist router', () => {
  it.each([
    ['Please check our stock and supplier schedule', 'operations'],
    ['Draft a reply to this customer complaint', 'customers'],
    ['Plan a social media marketing campaign', 'growth'],
    ['Summarise invoices and expenses this month', 'records'],
  ])('routes one clear domain: %s', (question, profile) => {
    expect(specialistProfileForRequest(question, specialists)?.profile).toBe(profile);
  });

  it('keeps ambiguous and cross-functional work with the Chief of Staff', () => {
    expect(specialistProfileForRequest('What should I focus on tomorrow?', specialists)).toBeUndefined();
    expect(specialistProfileForRequest(
      'Compare our customer complaints with the marketing campaign',
      specialists,
    )).toBeUndefined();
  });

  it('routes using the customer-defined role instead of a fixed system list', () => {
    const pastry = {
      id: 'custom', profile: 'sp-custom', name: 'Pastry R&D',
      description: 'Develop croissant recipes and test lamination.',
      instructions: 'Prefer local butter.', enabled: true,
    };
    expect(specialistProfileForRequest('Test a new croissant recipe', [pastry])).toBe(pastry);
    expect(specialistRunInstructions(pastry)).toMatch(/Pastry R&D specialist profile/);
    expect(specialistRunInstructions(pastry)).toMatch(/Prefer local butter/);
    expect(specialistRunInstructions(pastry)).toMatch(/do not expose internal profile names/);
  });
});
