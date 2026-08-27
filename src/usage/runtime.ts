import type { ContextBreakdown, ContextSavings, UsageBillingKind } from './types.js';
import type { UsageTracker } from './service.js';

let active: UsageTracker | undefined;
let billingForProfile: ((profileId: string) => UsageBillingKind | undefined) | undefined;
let nextContext: { contextUtilized?: number; contextBreakdown?: ContextBreakdown; contextSavings?: ContextSavings } | undefined;
/** Extension-host wiring for model paths that do not otherwise carry a UI dependency. */
export function setActiveUsageTracker(tracker: UsageTracker | undefined, billing?: (profileId: string) => UsageBillingKind | undefined): void { active = tracker; billingForProfile = billing; }
export function activeUsageTracker(): UsageTracker | undefined { return active; }
export function activeBillingForProfile(profileId: string): UsageBillingKind | undefined { return billingForProfile?.(profileId); }
export function setActiveContextMetrics(metrics: { contextUtilized?: number; contextBreakdown?: ContextBreakdown; contextSavings?: ContextSavings }): void { nextContext = { ...metrics, contextBreakdown: metrics.contextBreakdown ? { ...metrics.contextBreakdown } : undefined, contextSavings: metrics.contextSavings ? { ...metrics.contextSavings } : undefined }; }
export function consumeActiveContextMetrics(): { contextUtilized?: number; contextBreakdown?: ContextBreakdown; contextSavings?: ContextSavings } | undefined { const metrics = nextContext; nextContext = undefined; return metrics; }
