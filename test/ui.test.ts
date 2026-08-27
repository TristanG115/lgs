import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('product UI integrity', () => {
  it('contains no prototype navigation or fabricated task state', () => {
    const ui = source('src/webview/main.ts');
    expect(ui).not.toContain('workspace-nav');
    expect(ui).not.toContain('function newTask');
    expect(ui).not.toContain('Awaiting LGS investigation');
    expect(ui).not.toContain('data-action=approve');
    expect(ui).not.toContain('data-action=retry');
  });

  it('wires every rendered top-level action to a validated client message', () => {
    const ui = source('src/webview/main.ts');
    for (const message of ['openSettings', 'openUsage', 'newChat', 'selectProfile', 'selectModel', 'setOptions', 'userMessage', 'cancel', 'taskAction']) {
      expect(ui).toContain(`type: '${message}'`);
    }
    expect(source('src/shared/messages.ts')).not.toContain("'approve'");
  });

  it('keeps Follow VS Code entirely on semantic workbench variables', () => {
    const css = source('src/webview/styles.css');
    const followBlock = css.slice(css.indexOf(':root {'), css.indexOf('html[data-lgs-theme="lgs-light"]'));
    expect(followBlock).toContain('--vscode-');
    expect(followBlock).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
