import * as vscode from 'vscode';
import { createBackend, loadProfiles, normalizeProfile, saveProfiles, type BackendProfile } from '../model/profiles.js';
import type { SettingsManager } from './configuration.js';

type PanelMessage =
  | { type: 'setSetting'; id: string; value: unknown; scope: 'user' | 'workspace' }
  | { type: 'saveConnection'; connection: Partial<BackendProfile>; apiKey?: string; secretHeaders?: Record<string, string> }
  | { type: 'deleteConnection'; id: string }
  | { type: 'testConnection'; id: string };

export class SettingsPanel {
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: SettingsManager,
    private readonly onConnectionsChanged: () => Promise<void>,
    private readonly onSettingsChanged: () => void,
  ) {}

  show(): void {
    this.panel = vscode.window.createWebviewPanel('lgs.settings', 'LGS Settings', vscode.ViewColumn.One, { enableScripts: true });
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((raw: unknown) => void this.receive(raw));
    this.sendState();
  }

  private send(value: unknown): void { void this.panel?.webview.postMessage(value); }

  private state() {
    return {
      type: 'state',
      settings: this.manager.effective(),
      errors: this.manager.errorsList(),
      connections: loadProfiles(this.context).map(profile => ({
        id: profile.id, name: profile.name, kind: profile.kind, baseUrl: profile.baseUrl,
        enabled: profile.enabled, hasApiKey: Boolean(profile.secretName), headers: profile.headers,
        modelAliases: profile.modelAliases, capabilityOverrides: profile.capabilityOverrides, dataPolicy: profile.dataPolicy,
      })),
    };
  }

  private sendState(): void { this.send(this.state()); }

  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as PanelMessage;
    if (message.type === 'setSetting') {
      const error = await this.manager.set(message.id, message.value, message.scope);
      if (error) this.send({ type: 'error', message: error });
      else { this.onSettingsChanged(); this.sendState(); }
      return;
    }
    if (message.type === 'deleteConnection') {
      const old = loadProfiles(this.context).find(profile => profile.id === message.id);
      await saveProfiles(this.context, loadProfiles(this.context).filter(profile => profile.id !== message.id));
      if (old?.secretName) await this.context.secrets.delete(old.secretName);
      for (const header of old?.secretHeaderNames || []) await this.context.secrets.delete('lgs.connection.' + message.id + '.header.' + header);
      await this.onConnectionsChanged(); this.sendState(); return;
    }
    if (message.type === 'saveConnection') {
      const connection = normalizeProfile(message.connection);
      if (!connection.id || !connection.name || !connection.baseUrl) { this.send({ type: 'error', message: 'Connection ID, name, and base URL are required.' }); return; }
      connection.secretName = connection.secretName || 'lgs.connection.' + connection.id + '.api';
      connection.secretHeaderNames = Object.keys(message.secretHeaders || {});
      const profiles = loadProfiles(this.context).filter(profile => profile.id !== connection.id);
      profiles.push(connection); await saveProfiles(this.context, profiles);
      if (message.apiKey) await this.context.secrets.store(connection.secretName, message.apiKey);
      for (const [name, value] of Object.entries(message.secretHeaders || {})) await this.context.secrets.store('lgs.connection.' + connection.id + '.header.' + name, value);
      await this.onConnectionsChanged(); this.sendState(); return;
    }
    if (message.type === 'testConnection') {
      const profile = loadProfiles(this.context).find(candidate => candidate.id === message.id);
      if (!profile) { this.send({ type: 'connectionResult', id: message.id, ok: false, message: 'Connection not found.' }); return; }
      try {
        const key = profile.secretName ? await this.context.secrets.get(profile.secretName) : undefined;
        const models = await createBackend(profile, key).listModels();
        this.send({ type: 'connectionResult', id: profile.id, ok: true, message: 'Connection is reachable. Models discovered: ' + models.length });
      } catch (error) { this.send({ type: 'connectionResult', id: profile.id, ok: false, message: error instanceof Error ? error.message : 'Connection failed.' }); }
    }
  }

  private html(): string {
    const nonce = Date.now().toString(36);
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>${css()}</style></head><body><div id="app"></div><script nonce="${nonce}">${script()}</script></body></html>`;
  }
}

function css(): string {
  return `:root{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);--lgs-background:var(--vscode-editor-background);--lgs-surface:var(--vscode-sideBar-background);--lgs-raised:var(--vscode-editorWidget-background);--lgs-text:var(--vscode-foreground);--lgs-muted:var(--vscode-descriptionForeground);--lgs-border:var(--vscode-panel-border);--lgs-primary:var(--vscode-button-background)}*{box-sizing:border-box}body{margin:0}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}#app{display:flex;min-height:100vh}.nav{width:220px;padding:20px 10px;background:var(--lgs-surface);border-right:1px solid var(--lgs-border)}.nav h1{font-family:Georgia,serif;font-size:19px;margin:0 8px 18px}.nav button{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--lgs-text);padding:8px;border-radius:4px}.nav button.active,.nav button:hover{background:var(--vscode-list-activeSelectionBackground)}.content{max-width:900px;width:100%;padding:26px 34px}.section{display:none}.section.active{display:block}.card{background:var(--lgs-surface);border:1px solid var(--lgs-border);border-radius:6px;padding:14px;margin:12px 0}.muted,.source{color:var(--lgs-muted)}.source{font-size:11px}.field{display:flex;flex-direction:column;gap:6px;margin:8px 0;flex:1}input,select,textarea{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--lgs-border));padding:7px;border-radius:3px}.row{display:flex;gap:10px;flex-wrap:wrap}.primary{color:var(--vscode-button-foreground);background:var(--lgs-primary);border:0;padding:7px 11px;border-radius:3px}.danger{color:var(--vscode-errorForeground);background:transparent;border:1px solid var(--vscode-errorForeground);padding:6px 9px;border-radius:3px}.error{color:var(--vscode-errorForeground)}.success{color:var(--vscode-testing-iconPassed)}.theme-previews{display:flex;gap:8px;margin:8px 0}.theme-preview{border:1px solid var(--lgs-border);border-radius:5px;display:flex;flex:1;flex-direction:column;gap:4px;min-height:68px;padding:8px;font-size:11px}.theme-preview span{opacity:.8}.paper{background:#f5f1e7;color:#202824;border-color:#c8c1b2}.lab{background:#182525;color:#e4e8df;border-color:#3a4d49}.native{background:var(--vscode-editor-background);color:var(--vscode-foreground)}@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
}

function script(): string {
  return `const api=acquireVsCodeApi();const cats=['General','Appearance','Models & Providers','Agents','Integrations','Context','Verification','Git','Usage & Budgets','Memory','Skills','Permissions','Advanced'];let state;const slug=x=>x.toLowerCase().replaceAll(' ','-').replaceAll('&','and');const preview='<div class="theme-previews"><div class="theme-preview native"><b>Follow VS Code</b><span>Native editor roles</span></div><div class="theme-preview paper"><b>Research Paper</b><span>Warm, focused light</span></div><div class="theme-preview lab"><b>Research Lab</b><span>Deep, quiet dark</span></div></div>';function render(){app.innerHTML='<nav class=nav><h1>LGS Settings</h1>'+cats.map(x=>'<button class=navbtn data-s='+slug(x)+'>'+x+'</button>').join('')+'</nav><main class=content>'+cats.map(x=>'<section class=section id='+slug(x)+'><h2>'+x+'</h2><div class=body></div></section>').join('')+'</main>';document.querySelector('.navbtn').classList.add('active');document.querySelector('.section').classList.add('active');document.querySelectorAll('.navbtn').forEach(button=>button.onclick=()=>{document.querySelectorAll('.navbtn,.section').forEach(x=>x.classList.remove('active'));button.classList.add('active');document.querySelector('#'+button.dataset.s).classList.add('active')});renderSettings();renderConnections()}function renderSettings(){state.settings.forEach(item=>{const box=document.querySelector('#'+slug(item.category)+' .body');if(!box)return;if(item.type==='placeholder'){box.innerHTML+='<div class=card><strong>'+item.label+'</strong><p class=muted>'+item.description+'</p><span class=source>Available in a future phase.</span></div>';return}const input=item.type==='select'?'<select data-id='+item.id+'>'+item.choices.map(c=>'<option value='+c.value+(c.value===item.value?' selected':'')+'>'+c.label+'</option>').join('')+'</select>':'<input data-id='+item.id+' type='+(item.type==='number'?'number':'text')+' value='+(item.value??'')+'>';box.innerHTML+='<div class=card><label class=field><strong>'+item.label+'</strong><span class=muted>'+item.description+'</span>'+(item.id==='appearance.theme'?preview:'')+input+'<span class=source>Effective source: '+item.source+'</span><select data-scope='+item.id+'><option value=user>User setting</option><option value=workspace>Workspace setting</option></select></label><button class=primary data-save='+item.id+'>Apply setting</button></div>'});document.querySelectorAll('[data-save]').forEach(button=>button.onclick=()=>{const id=button.dataset.save,input=document.querySelector('[data-id='+id+']');api.postMessage({type:'setSetting',id,value:input.type==='number'?Number(input.value):input.value,scope:document.querySelector('[data-scope='+id+']').value})})}function renderConnections(){const box=document.querySelector('#models-and-providers .body');box.innerHTML='<p class=muted>Existing secrets are never sent to this page. Set a data policy so Adaptive Routing knows whether repository source may leave this device.</p>'+state.connections.map(c=>'<div class=card><strong>'+c.name+'</strong><p class=muted>'+c.kind+' · '+c.baseUrl+'</p><p class=source>'+(c.enabled?'Enabled':'Disabled')+' · '+(c.dataPolicy||'repository_allowed')+'</p><button class=primary data-test='+c.id+'>Test connection</button> <button class=danger data-delete='+c.id+'>Delete</button><p data-result='+c.id+'></p></div>').join('')+'<div class=card><h3>Add connection</h3><form id=connection><div class=row><label class=field>ID<input name=id required></label><label class=field>Name<input name=name required></label></div><div class=row><label class=field>Provider<select name=kind><option value=openai-compatible>OpenAI-compatible</option><option value=ollama>Ollama</option><option value=anthropic>Anthropic</option></select></label><label class=field>Base URL<input name=baseUrl required></label></div><label class=field>Data policy<select name=dataPolicy><option value=local>Local only</option><option value=repository_allowed>Repository source allowed</option><option value=metadata_only>Metadata only</option></select></label><label class=field>API key<input name=apiKey type=password placeholder=Optional></label><label class=field>Ordinary headers JSON<textarea name=headers placeholder=Optional></textarea></label><label class=field>Secret headers JSON<textarea name=secretHeaders placeholder=Optional></textarea></label><label class=field>Model aliases JSON<textarea name=modelAliases placeholder=Optional></textarea></label><label class=field>Capability overrides JSON<textarea name=capabilityOverrides placeholder=Optional></textarea></label><label><input name=enabled type=checkbox checked> Enabled</label><button class=primary>Save connection</button></form></div>';document.querySelectorAll('[data-test]').forEach(button=>button.onclick=()=>api.postMessage({type:'testConnection',id:button.dataset.test}));document.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>api.postMessage({type:'deleteConnection',id:button.dataset.delete}));document.querySelector('#connection').onsubmit=event=>{event.preventDefault();const form=new FormData(event.target);let secretHeaders={},headers={},modelAliases={},capabilityOverrides={};try{secretHeaders=JSON.parse(form.get('secretHeaders')||'{}');headers=JSON.parse(form.get('headers')||'{}');modelAliases=JSON.parse(form.get('modelAliases')||'{}');capabilityOverrides=JSON.parse(form.get('capabilityOverrides')||'{}')}catch{alert('Connection JSON fields must be valid JSON.');return}api.postMessage({type:'saveConnection',secretHeaders,connection:{id:form.get('id'),name:form.get('name'),kind:form.get('kind'),baseUrl:form.get('baseUrl'),dataPolicy:form.get('dataPolicy'),enabled:form.get('enabled')==='on',headers,secretHeaderNames:Object.keys(secretHeaders),modelAliases,capabilityOverrides},apiKey:form.get('apiKey')||undefined})}}window.addEventListener('message',event=>{if(event.data.type==='state'){state=event.data;render()}if(event.data.type==='error')alert(event.data.message);if(event.data.type==='connectionResult'){const result=document.querySelector('[data-result='+event.data.id+']');if(result){result.textContent=event.data.message;result.className=event.data.ok?'success':'error'}}});api.postMessage({type:'requestState'});`;
}
