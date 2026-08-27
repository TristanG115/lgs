import type { UsageBillingKind } from './types.js';
import type { UsageTracker } from './service.js';

let active: UsageTracker | undefined;
let billingForProfile: ((profileId: string) => UsageBillingKind | undefined) | undefined;
/** Extension-host wiring for model paths that do not otherwise carry a UI dependency. */
export function setActiveUsageTracker(tracker: UsageTracker | undefined, billing?: (profileId: string) => UsageBillingKind | undefined): void { active = tracker; billingForProfile = billing; }
export function activeUsageTracker(): UsageTracker | undefined { return active; }
export function activeBillingForProfile(profileId: string): UsageBillingKind | undefined { return billingForProfile?.(profileId); }
