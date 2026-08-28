import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ActivityEvent, RequestExecution } from './types.js';

export type ActivitySnapshot = { request: RequestExecution; events: ActivityEvent[] };
export class ActivityLogPanel {
  private panel?: vscode.WebviewPanel; private current?: ActivitySnapshot;
  constructor(private readonly context: vscode.ExtensionContext, private readonly snapshot: (requestId: string) => ActivitySnapshot | undefined, private readonly workspaceRoot?: string) {}
  show(requestId: string): void {
    this.current = this.snapshot(requestId); if (!this.current) return;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('lgs.activity', 'LGS Activity', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((value: unknown) => void this.receive(value));
      this.panel.webview.html = html();
    } else this.panel.reveal(vscode.ViewColumn.Beside, true);
    this.publish();
  }
  update(request: RequestExecution, events: ActivityEvent[]): void { if (this.current?.request.id !== request.id) return; this.current = { request, events }; this.publish(); }
  private publish(): void { if (this.current) void this.panel?.webview.postMessage({ type: 'snapshot', ...this.current }); }
  private async receive(value: unknown): Promise<void> {
    if (!record(value) || value.type !== 'openFile' || typeof value.path !== 'string' || !this.workspaceRoot) return;
    const target = path.resolve(this.workspaceRoot, value.path); const relative = path.relative(this.workspaceRoot, target); if (relative.startsWith('..') || path.isAbsolute(relative)) return;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target)); const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    if (Number.isInteger(value.line) && Number(value.line) > 0) { const position = new vscode.Position(Number(value.line) - 1, 0); editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position)); }
  }
}
function html(): string {
  const nonce = Date.now().toString(36); return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:12px var(--vscode-font-family);height:100vh;display:flex;flex-direction:column}header{padding:10px 12px 8px;border-bottom:1px solid var(--vscode-panel-border);display:flex;align-items:center;justify-content:space-between}h1{font-size:12px;margin:0;font-weight:600}.meta{color:var(--vscode-descriptionForeground);font-size:11px}.filters{display:flex;gap:2px;padding:6px 10px;border-bottom:1px solid var(--vscode-panel-border)}button{font:inherit;color:inherit;border:0;background:transparent;border-radius:4px;padding:3px 7px;cursor:pointer}button:hover,button[aria-pressed=true]{background:var(--vscode-toolbar-hoverBackground)}main{overflow:auto;padding:4px 0}.event{display:grid;grid-template-columns:62px 10px minmax(0,1fr);gap:7px;padding:5px 12px;border-left:2px solid transparent}.event:hover{background:var(--vscode-list-hoverBackground)}.event.failed,.event.error{border-left-color:var(--vscode-errorForeground)}time{font:11px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground)}i{width:6px;height:6px;border-radius:50%;background:var(--vscode-descriptionForeground);margin-top:4px}.success i{background:var(--vscode-testing-iconPassed)}.failed i,.error i{background:var(--vscode-errorForeground)}.started i{background:var(--vscode-progressBar-background)}.summary{line-height:1.35}.resource{padding:0;color:var(--vscode-textLink-foreground);font-family:var(--vscode-editor-font-family);text-align:left}.detail{display:block;color:var(--vscode-descriptionForeground);white-space:pre-wrap;margin-top:2px}details{margin-top:2px}summary{cursor:pointer;color:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap;margin:5px 0 0;padding:7px;background:var(--vscode-textCodeBlock-background);font:11px var(--vscode-editor-font-family)}.empty{padding:24px 12px;color:var(--vscode-descriptionForeground)}</style></head><body><header><h1>Activity trace</h1><span class="meta" id="meta"></span></header><div class="filters" id="filters"></div><main id="events"><div class="empty">No activity recorded.</div></main><script nonce="${nonce}">
  const vscode=acquireVsCodeApi(),root=document.getElementById('events'),meta=document.getElementById('meta'),filters=document.getElementById('filters');let snapshot,filter='all';
  const groups=[['all','All'],['file','Files'],['command','Commands'],['browser','Browser'],['test','Tests'],['error','Errors']];
  function esc(v){const d=document.createElement('div');d.textContent=String(v||'');return d.innerHTML}function render(){if(!snapshot)return;const events=snapshot.events.filter(e=>filter==='all'||e.type===filter||(filter==='error'&&(e.type==='error'||e.status==='failed')));meta.textContent=events.length+' events · '+snapshot.request.status;filters.innerHTML=groups.map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(id===filter)+'">'+label+'</button>').join('');filters.querySelectorAll('button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});root.innerHTML=events.length?events.map(e=>'<article class="event '+esc(e.status||e.type)+'"><time>'+new Date(e.timestamp).toLocaleTimeString([], {hour12:false})+'</time><i></i><div class="summary">'+esc(e.summary)+(e.resource?.kind==='file'?'<br><button class="resource" data-path="'+esc(e.resource.value)+'" data-line="'+(e.resource.line||'')+'">'+esc(e.resource.value)+'</button>':'')+(e.detail?'<details><summary>Details</summary><pre>'+esc(e.detail)+'</pre></details>':'')+'</div></article>').join(''):'<div class="empty">No matching activity.</div>';root.querySelectorAll('[data-path]').forEach(b=>b.onclick=()=>vscode.postMessage({type:'openFile',path:b.dataset.path,line:Number(b.dataset.line)||undefined}));root.scrollTop=root.scrollHeight}
  addEventListener('message',e=>{if(e.data?.type==='snapshot'){snapshot=e.data;render()}});</script></body></html>`;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
