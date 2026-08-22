import type { DistillerStrategy } from '../types/legion-settings.js';

/** Keeps synthesis available only when a user opts into it explicitly. */
export const resolveDistillerStrategy = (
  configured: DistillerStrategy | undefined,
): DistillerStrategy => configured ?? 'select-best';
