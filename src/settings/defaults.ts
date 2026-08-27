import { type SettingDefinition, SettingsRegistry } from './registry.js';

const permissionChoices = [
  { value: 'always_allow', label: 'Always allow' },
  { value: 'ask', label: 'Ask each time' },
  { value: 'deny', label: 'Deny' },
];

export function createDefaultRegistry(): SettingsRegistry {
  const registry = new SettingsRegistry();
  registry.register({
    id: 'appearance.theme', category: 'Appearance', label: 'Appearance',
    description: 'Choose the LGS research identity or inherit the active VS Code theme.',
    type: 'select', default: 'vscode', scope: 'both', choices: [
      { value: 'vscode', label: 'Follow VS Code' },
      { value: 'lgs-light', label: 'Research Paper / Light' },
      { value: 'lgs-dark', label: 'Research Lab / Dark' },
    ],
  });
  registry.register({
    id: 'models.defaultConnection', category: 'Models & Providers', label: 'Default connection',
    description: 'Connection selected when a new LGS session opens.', type: 'string', default: '', scope: 'both',
  });
  registry.register({
    id: 'models.defaultModel', category: 'Models & Providers', label: 'Default model',
    description: 'Preferred model when it is available on the selected connection.', type: 'string', default: '', scope: 'both',
  });
  for (const [id, label, description, defaultValue] of [
    ['computer.readOutsideWorkspace', 'Read outside workspace', 'Permission policy for external file reads.', 'ask'],
    ['computer.writeOutsideWorkspace', 'Write outside workspace', 'Permission policy for external file changes.', 'ask'],
    ['computer.systemCommandPolicy', 'System command policy', 'Permission policy for non-workspace commands.', 'ask'],
    ['computer.packageInstallationPolicy', 'Package installation policy', 'Permission policy for software installation or removal.', 'ask'],
    ['computer.elevatedCommandPolicy', 'Elevated command policy', 'Administrator operations always require explicit approval.', 'ask'],
    ['computer.externalDocumentAccess', 'External document access', 'Permission policy for deterministic document extraction.', 'ask'],
  ] as const) registry.register({
    id, category: 'Computer Access', label, description, type: 'select', default: defaultValue,
    scope: 'both', choices: permissionChoices,
  });
  registry.register({
    id: 'computer.dryRun', category: 'Computer Access', label: 'Dry-run external commands',
    description: 'Return a command plan before external execution unless explicitly overridden.',
    type: 'boolean', default: true, scope: 'both',
  });
  registry.register({
    id: 'computer.activityLogRetentionDays', category: 'Computer Access', label: 'Activity retention (days)',
    description: 'Number of days to retain local computer-operation records.', type: 'number', default: 90, scope: 'both',
    validate: value => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650
      ? undefined : 'Enter a whole number from 1 to 3650.',
  });
  return registry;
}

// These sections use structured .lgs/config.yaml rather than pretend scalar controls.
export const CONFIGURATION_CATEGORIES = [
  'General', 'Agents', 'Integrations', 'Context', 'Verification', 'Git', 'Usage & Budgets',
  'Memory', 'Skills', 'Permissions', 'Advanced',
];
export type LgsSettingDefinition = SettingDefinition;
