export const mainJS = `
import { html, render } from 'https://unpkg.com/lit-html?module';
const tg = window.Telegram.WebApp;
const state = { name: "||botName||", kind: "||botKind||", config: ||configJson||, activeTab: 'flow' };
function renderApp() { render(App(state), document.getElementById('root')); }
function App(s) {
    return html\`<div class="container">
        <h1>\${s.name}</h1>
        <nav class="tabs">
            <button class="\${s.activeTab==='flow'?'active':''}" @click=\${()=>{s.activeTab='flow';renderApp();}}>Flujo</button>
            <button class="\${s.activeTab==='preview'?'active':''}" @click=\${()=>{s.activeTab='preview';renderApp();}}>Preview</button>
        </nav>
        <main>
            \${s.activeTab==='flow' ? html\`<div>\${s.config.steps?.map(step=>html\`<div class="card">\${step.label}</div>\`)}</div>\` : ''}
            \${s.activeTab==='preview' ? html\`<div class="chat">\${s.config.business_identity?.welcome_message}</div>\` : ''}
        </main>
    </div>\`;
}
tg.ready(); renderApp();
`;
