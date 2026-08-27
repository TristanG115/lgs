import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseUsageConfiguration, FilePricingStore, FileUsageStore, UsageTracker } from '../src/usage/index.js';
import { ModelRouter, parseRoutingConfiguration } from '../src/routing/index.js';

describe('Usage, Context and Cost Observatory', () => {
  it('persists normalized metrics, keeps unavailable values absent, and aggregates by requested views', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-usage-'));
    const pricing = new FilePricingStore(root); pricing.update({ 'cloud:large': { billing: 'commercial', inputPerMillionUsd: 2, outputPerMillionUsd: 8 }, campus: { billing: 'institution_provided' } });
    const tracker = new UsageTracker(new FileUsageStore(root), pricing, parseUsageConfiguration({ budgets: { askBeforeCloudEscalation: false } }));
    const first = tracker.begin({ workspace: 'lgs', providerConnection: 'cloud', model: 'large', agent: 'manager-1', role: 'manager', task: 'phase-22', session: 'chat-1', contextMaximum: 32000, contextUtilized: 21800, contextBreakdown: { objective: 400, source: 10000 }, contextSavings: { rawCandidateTokens: 40000, selectedTokens: 21800, tokensAvoided: 18200, reductionPercent: 45.5 } });
    first.observe({ type: 'textDelta', text: 'Hello' }); first.observe({ type: 'usage', usage: { inputTokens: 1000, outputTokens: 500, cachedTokens: 200, reasoningTokens: 20 } }); const record = first.finish()!;
    const campus = tracker.begin({ providerConnection: 'campus', model: 'purdue', task: 'phase-22' }); campus.observe({ type: 'usage', usage: { inputTokens: 10 } }); campus.finish();
    expect(record.estimatedCostUsd).toBe(0.006); expect(record.providerReportedCostUsd).toBeUndefined(); expect(record.contextUtilized).toBe(21800);
    const dashboard = tracker.dashboard('phase-22'); expect(dashboard.aggregates.model[0]).toMatchObject({ key: 'large', inputTokens: 1000, contextAvoided: 18200 }); expect(dashboard.records.find(value => value.providerConnection === 'campus')?.billing).toBe('institution_provided');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('enforces retention and prevents automatic cloud routes when a spend policy requires confirmation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-usage-')); const configuration = parseUsageConfiguration({ retentionDays: 1, maxRecords: 1, budgets: { askBeforeCloudEscalation: true } }); const tracker = new UsageTracker(new FileUsageStore(root), new FilePricingStore(root), configuration);
    const measurement = tracker.begin({ providerConnection: 'cloud', model: 'large', task: 'task' }); measurement.observe({ type: 'usage', usage: { inputTokens: 1 } }); measurement.finish();
    const router = new ModelRouter(parseRoutingConfiguration({ roles: { cloudEscalation: { profileId: 'cloud', model: 'large' } } }), () => 'repository_allowed', request => tracker.budgetDecision(request.taskId));
    expect(router.route({ role: 'cloudEscalation', fallback: { profileId: 'local', model: 'small' }, taskId: 'task' })).toMatchObject({ blocked: true, requiresApproval: true });
    expect(tracker.cleanup()).toBe(0); fs.rmSync(root, { recursive: true, force: true });
  });
});
