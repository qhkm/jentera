import { confirmedValue, hasConfirmedValue } from '@/lib/knowledge';
import type { BusinessSnapshot } from '@/lib/repo';

export const workflowCategories = ['sales', 'admin', 'reports', 'research', 'marketing', 'other'] as const;
export type WorkflowCategory = typeof workflowCategories[number];
export const workflowCategoryKey = 'business.workflow.category';
export const workflowTaskKey = 'business.workflow.task';

export function firstWorkflowTask(snapshot: BusinessSnapshot): string {
  const fact = snapshot.facts.find(f => f.key === workflowTaskKey && hasConfirmedValue(f));
  const value = fact ? confirmedValue(fact) : null;
  if (typeof value !== 'string') return '';
  const task = value.trim();
  return task.length <= 2000 ? task : '';
}
