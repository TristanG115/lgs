import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseRoutingConfiguration, FileRoutingDecisionStore, ModelRouter } from '../src/routing/index.js';
import { EscalationController } from '../src/watchdog/escalation.js';
import { FileTaskStateStore } from '../src/watchdog/state.js';
import { parseWatchdogConfiguration } from '../src/watchdog/config.js';

describe('Adaptive Model Routing', () => {
  it('chooses the cheapest eligible local capable model and explains it', () => {
    const config = parseRoutingConfiguration({ models: [
      { profileId: 'local', model: 'small', toolSupport: true, costTier: 'low', benchmarkScore: 4 },
      { profileId: 'cloud', model: 'large', toolSupport: true, costTier: 'high', benchmarkScore: 9 }
    ], policy: { privacy: 'cloud_allowed', preferLocal: true, preferCheapest: true } });
    const decision = new ModelRouter(config, id => id === 'local' ? 'local' : 'repository_allowed').route({ role: 'worker', fallback: { profileId: 'cloud', model: 'fallback' }, needsTools: true });
    expect(decision.identity).toEqual({ profileId: 'local', model: 'small' });
    expect(decision.reason).toContain('local privacy preference');
  });

  it('blocks cloud source transfers for local_only and metadata-only providers', () => {
    const config = parseRoutingConfiguration({ roles: { manager: { profileId: 'cloud', model: 'remote' } }, policy: { privacy: 'local_only', preferLocal: true, preferCheapest: false } });
    const decision = new ModelRouter(config, () => 'repository_allowed').route({ role: 'manager', fallback: { profileId: 'cloud', model: 'fallback' } });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toContain('local_only');
    const metadata = new ModelRouter(parseRoutingConfiguration({ policy: { privacy: 'cloud_allowed', preferLocal: false, preferCheapest: false } }), () => 'metadata_only').route({ role: 'worker', fallback: { profileId: 'metadata', model: 'm' } });
    expect(metadata.blocked).toBe(true);
  });

  it('honors manual task pins and records each decision without source text', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-routing-'));
    const decision = new ModelRouter(parseRoutingConfiguration(), () => 'local').route({ role: 'reviewer', fallback: { profileId: 'local', model: 'default' }, taskModel: { profileId: 'local', model: 'pinned' } });
    const store = new FileRoutingDecisionStore(root); store.record('task-21', decision);
    expect(store.read('task-21')).toMatchObject([{ identity: { profileId: 'local', model: 'pinned' }, reason: 'Manual pin selected.' }]);
    expect(JSON.stringify(store.read('task-21'))).not.toContain('repository source');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('applies routing policy to Phase 11 escalation destinations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-routing-')); const state = new FileTaskStateStore(root); state.ensure('task-21', 'Route escalation');
    const router = new ModelRouter(parseRoutingConfiguration({ policy: { privacy: 'local_only', preferLocal: true, preferCheapest: false } }), () => 'repository_allowed');
    const escalation = new EscalationController(root, parseWatchdogConfiguration({ escalation: { routes: { difficult: { profileId: 'cloud', model: 'large' } } } }), state, { profileId: 'local', model: 'small' }, 'manager', router);
    expect(escalation.escalate('task-21', 'repeated_failure', 'Needs a stronger model.').to).toBeUndefined();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
