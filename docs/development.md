# Development and verification

## Commands

```text
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

The Git, command, runtime, and verified-commit tests create disposable child processes and a loopback server. A restricted sandbox may produce `spawnSync git EPERM`, empty child stdout, or `listen EPERM`; rerun the same suite in an environment that permits those operations before diagnosing an implementation failure.

## Extension Development Host

Open the repository in VS Code and press F5. The configured pre-launch task builds the extension. On Flatpak VS Code, `.vscode/tasks.json` sources the Flatpak NVM installation before running npm.

Runtime acceptance should cover:

- activation and command registration;
- sidebar readiness handshake and provider error/success state;
- Settings opening from both command palette and gear;
- Follow VS Code, Research Paper, and Research Lab runtime themes;
- narrow sidebar and wide settings overflow;
- loading, error, disabled, task, evidence, and usage views;
- Extension Host and webview console logs.

## Repository artifacts

Run **LGS: Rebuild Repository Index** after meaningful source or documentation changes. This regenerates both `.lgs/index.json` and `.lgs/CODEBASE_MAP.md`. Completion evidence that predates later changes is stale by design and must be recreated.

