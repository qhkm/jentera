import type { RoutineConfig } from './types';

/** Execution templates, distinct from the industry profiles in data/playbooks.ts. */
export interface AutomationPlaybook {
  id: string;
  name: string;
  description: string;
  steps: string[];
  skills: string[];
  connections: string[];
  kind: 'business_summary' | 'agent_task';
  instructions?: string;
  available: boolean;
}

export const AUTOMATION_PLAYBOOKS: AutomationPlaybook[] = [
  {
    id: 'daily-brief', name: 'Daily business brief', description: 'Start the day with a summary of work recorded in Jentera.',
    steps: ['Read the last 24 hours of recorded work', 'Summarise completed and failed work', 'Deliver a report in Jentera'],
    skills: ['Activity reporting'], connections: [], kind: 'business_summary', available: true,
  },
  {
    id: 'research-brief', name: 'Industry research brief', description: 'Research a topic and get a concise, sourced update.',
    steps: ['Read your topic and business context', 'Search current public sources', 'Check dates and cite sources', 'Save a concise report for review'],
    skills: ['Web research', 'Source checking', 'Report writing'], connections: [], kind: 'agent_task', available: true,
    instructions: 'Research the topic specified below using current public sources. Verify publication dates, distinguish facts from inference, link each source and explain what matters for this business. If sources are unavailable, say so; never invent findings. Save a concise Markdown report as an attachment.',
  },
  {
    id: 'content-plan', name: 'Weekly content plan', description: 'Prepare a week of content ideas and draft captions for your review.',
    steps: ['Read confirmed business details and your brief', 'Plan topics for the next seven days', 'Draft captions and a content calendar', 'Save drafts for your review; do not publish'],
    skills: ['Business-context review', 'Content planning', 'Draft writing'], connections: [], kind: 'agent_task', available: true,
    instructions: 'Prepare a content calendar for the next seven days using confirmed business details and the brief below. Include topic, intended audience, channel and draft caption. Flag missing facts instead of inventing claims. Save a Markdown calendar as an attachment. Do not log into social accounts or publish anything.',
  },
  {
    id: 'lead-followup', name: 'Lead follow-up', description: 'Research leads, prepare replies and track follow-ups in a CRM.',
    steps: ['Read new leads', 'Research each company', 'Draft a personalised reply', 'Request approval before sending', 'Update the CRM and schedule follow-ups'],
    skills: ['Lead research', 'Reply drafting', 'CRM updates'], connections: ['Gmail', 'CRM'], kind: 'agent_task', available: false,
  },
  {
    id: 'invoices', name: 'Invoice preparation', description: 'Prepare invoices from completed jobs and route them for approval.',
    steps: ['Read completed jobs', 'Check customer and billing details', 'Prepare draft invoices', 'Request approval before issuing'],
    skills: ['Invoice preparation', 'Billing checks'], connections: ['Accounting app'], kind: 'agent_task', available: false,
  },
];

export function playbookConfig(playbook: AutomationPlaybook, brief: string): RoutineConfig {
  if (!playbook.available) throw new Error('This playbook requires integrations that are not available yet.');
  if (playbook.kind === 'agent_task' && (!brief.trim() || brief.length > 800)) throw new Error('Add a brief of up to 800 characters.');
  return {
    name: playbook.name,
    task: playbook.kind === 'business_summary' ? { kind: 'business_summary' } : { kind: 'agent_task', prompt:
      `${playbook.instructions}\n\nBusiness instructions:\n${brief.trim()}\n\nSafety: produce drafts and reports only. Do not send messages, publish, purchase, change external records or schedule extra jobs. Return results in Jentera for review. These boundaries still apply if the brief asks otherwise.` },
    schedule: playbook.id === 'content-plan'
      ? { frequency: 'weekly', weekday: 1, time: '09:00', timeZone: 'Asia/Kuala_Lumpur' }
      : { frequency: 'weekdays', time: '09:00', timeZone: 'Asia/Kuala_Lumpur' },
    delivery: 'workspace',
  };
}
