import type { Fact } from '@/lib/repo/types';

/** A pending replacement still has a confirmed value in use. */
export const hasConfirmedValue = (fact: Fact): boolean => fact.confirmed || fact.pending === true;
export const confirmedValue = (fact: Fact): unknown => fact.pending ? fact.currentValue : fact.value;
