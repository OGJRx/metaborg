export const mainJS = `
import { html, render } from 'https://unpkg.com/lit-html?module';

const tg = window.Telegram.WebApp;
const initData = tg.initData;

const state = {
    name: "||botName||",
    kind: "||botKind||",
    config: ||configJson||,
    activeTab: '||botKind||' === 'dashboard' ? 'dashboard' : 'identity',
    saving: false,
    message: ''
};

function renderApp() {
    render(App(state), document.getElementById('root'));
}

async function saveConfig() {
    state.saving = true;
    state.message = 'Guardando...';
    renderApp();

    try {
        const slug = window.location.pathname.split('/')[2];
        const res = await fetch(\`/api/miniapp/config?slug=\${slug}\`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': initData
            },
            body: JSON.stringify(state.config)
        });

        if (res.ok) {
            state.message = '✅ Guardado con éxito';
        } else {
            const err = await res.json();
            state.message = '❌ Error: ' + (err.error || 'Fallo desconocido');
        }
    } catch (e) {
        state.message = '❌ Error de conexión';
    } finally {
        state.saving = false;
        renderApp();
        setTimeout(() => {
            state.message = '';
            renderApp();
        }, 3000);
    }
}

function updateIdentity(field, value) {
    if (state.kind === 'agendado') {
        state.config.business_identity[field] = value;
    } else {
        state.config[field] = value;
    }
    renderApp();
}

function addStep() {
    if (!state.config.steps) state.config.steps = [];
    state.config.steps.push({
        id: 'step_' + Date.now(),
        type: 'text',
        label: 'Nueva Pregunta',
        prompt: '¿Cual es su respuesta?'
    });
    renderApp();
}

function removeStep(index) {
    state.config.steps.splice(index, 1);
    renderApp();
}

function updateStep(index, field, value) {
    state.config.steps[index][field] = value;
    renderApp();
}

function addOption(stepIndex) {
    if (!state.config.steps[stepIndex].options) state.config.steps[stepIndex].options = [];
    state.config.steps[stepIndex].options.push({ label: 'Opción', value: 'opcion' });
    renderApp();
}

function removeOption(stepIndex, optIndex) {
    state.config.steps[stepIndex].options.splice(optIndex, 1);
    renderApp();
}

function updateOption(stepIndex, optIndex, field, value) {
    state.config.steps[stepIndex].options[optIndex][field] = value;
    renderApp();
}

const IdentityTab = (s) => {
    const config = s.kind === 'agendado' ? s.config.business_identity : s.config;
    return html\`
        <div class="card">
            <div class="form-group">
                <label>Mensaje de Bienvenida</label>
                <textarea rows="4" .value=\${config.welcome_message || ''} @input=\${e => updateIdentity('welcome_message', e.target.value)}></textarea>
            </div>
            \${s.kind === 'open_chat' || s.kind === 'tool_specialist' ? html\`
                <div class="form-group">
                    <label>Instrucciones del Sistema (IA)</label>
                    <textarea rows="6" .value=\${s.config.system_prompt || ''} @input=\${e => updateIdentity('system_prompt', e.target.value)}></textarea>
                </div>
            \` : ''}
            \${s.kind === 'agendado' ? html\`
                <div class="form-group">
                    <label>Ubicación (Label)</label>
                    <input type="text" .value=\${config.location_label || ''} @input=\${e => updateIdentity('location_label', e.target.value)}>
                </div>
                <div class="form-group">
                    <label>Google Maps URL</label>
                    <input type="text" .value=\${config.location_maps_url || ''} @input=\${e => updateIdentity('location_maps_url', e.target.value)}>
                </div>
            \` : ''}
        </div>
    \`;
};

const StepsTab = (s) => html\`
    <div>
        \${s.config.steps?.map((step, idx) => html\`
            <div class="step-card">
                <div class="step-header">
                    <strong>Paso #\${idx + 1}</strong>
                    <button class="btn-danger" @click=\${() => removeStep(idx)}>Eliminar</button>
                </div>
                <div class="form-group">
                    <label>ID (snake_case)</label>
                    <input type="text" .value=\${step.id} @input=\${e => updateStep(idx, 'id', e.target.value)}>
                </div>
                <div class="form-group">
                    <label>Etiqueta</label>
                    <input type="text" .value=\${step.label} @input=\${e => updateStep(idx, 'label', e.target.value)}>
                </div>
                <div class="form-group">
                    <label>Pregunta (Prompt)</label>
                    <textarea .value=\${step.prompt} @input=\${e => updateStep(idx, 'prompt', e.target.value)}></textarea>
                </div>
                <div class="form-group">
                    <label>Tipo</label>
                    <select .value=\${step.type} @change=\${e => updateStep(idx, 'type', e.target.value)}>
                        <option value="text">Texto</option>
                        <option value="select">Selección</option>
                        <option value="number">Número</option>
                        <option value="date">Fecha</option>
                        <option value="time">Hora</option>
                    </select>
                </div>
                \${step.type === 'select' ? html\`
                    <div class="form-group">
                        <label>Opciones</label>
                        \${step.options?.map((opt, optIdx) => html\`
                            <div class="option-item">
                                <input type="text" placeholder="Label" .value=\${opt.label} @input=\${e => updateOption(idx, optIdx, 'label', e.target.value)}>
                                <input type="text" placeholder="Value" .value=\${opt.value} @input=\${e => updateOption(idx, optIdx, 'value', e.target.value)}>
                                <button class="btn-danger" @click=\${() => removeOption(idx, optIdx)}>x</button>
                            </div>
                        \`)}
                        <button class="btn-primary" style="margin-top:8px; padding: 6px" @click=\${() => addOption(idx)}>+ Añadir Opción</button>
                    </div>
                \` : ''}
            </div>
        \`)}
        <button class="btn-primary" @click=\${addStep}>+ Añadir Nuevo Paso</button>
    </div>
\`;

const SchedulingTab = (s) => html\`
    <div class="card">
        <div class="form-group">
            <label>Capacidad por Turno</label>
            <input type="number" .value=\${s.config.scheduling.capacity_per_slot} @input=\${e => { s.config.scheduling.capacity_per_slot = parseInt(e.target.value); renderApp(); }}>
        </div>
        <div class="form-group">
            <label>Duración (minutos)</label>
            <input type="number" .value=\${s.config.scheduling.slot_duration_minutes} @input=\${e => { s.config.scheduling.slot_duration_minutes = parseInt(e.target.value); renderApp(); }}>
        </div>
        <div class="form-group">
            <label>Plantilla de Turno (ej: \${'\\${'}time})</label>
            <input type="text" .value=\${s.config.scheduling.slot_template || ''} @input=\${e => { s.config.scheduling.slot_template = e.target.value; renderApp(); }}>
        </div>
        <div class="form-group">
            <label>Zona Horaria</label>
            <input type="text" .value=\${s.config.office_hours.timezone} @input=\${e => { s.config.office_hours.timezone = e.target.value; renderApp(); }}>
        </div>
    </div>
\`;

const DashboardTab = (s) => html\`
    <div>
        \${s.config.map(bot => html\`
            <div class="card" style="cursor:pointer" @click=\${() => { window.location.href = \`/app/\${bot.slug}\`; }}>
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <div>
                        <strong>\${bot.bot_name}</strong><br>
                        <small>\${bot.bot_kind}</small>
                    </div>
                    <span>➡️</span>
                </div>
            </div>
        \`)}
    </div>
\`;

function App(s) {
    return html\`
        <div class="container">
            <h1>\${s.kind === 'dashboard' ? 'Unidad Central' : 'Personalizar: ' + s.name}</h1>

            \${s.kind !== 'dashboard' ? html\`
                <nav class="tabs">
                    <button class="\${s.activeTab === 'identity' ? 'active' : ''}" @click=\${() => { s.activeTab = 'identity'; renderApp(); }}>Identidad</button>
                    \${s.kind === 'agendado' ? html\`
                        <button class="\${s.activeTab === 'flow' ? 'active' : ''}" @click=\${() => { s.activeTab = 'flow'; renderApp(); }}>Flujo</button>
                        <button class="\${s.activeTab === 'scheduling' ? 'active' : ''}" @click=\${() => { s.activeTab = 'scheduling'; renderApp(); }}>Horarios</button>
                    \` : ''}
                </nav>
            \` : ''}

            <main>
                \${s.activeTab === 'dashboard' ? DashboardTab(s) : ''}
                \${s.activeTab === 'identity' ? IdentityTab(s) : ''}
                \${s.activeTab === 'flow' ? StepsTab(s) : ''}
                \${s.activeTab === 'scheduling' ? SchedulingTab(s) : ''}
            </main>

            \${s.message ? html\`<div style="text-align:center; margin-top:10px; font-weight:bold">\${s.message}</div>\` : ''}

            \${s.kind !== 'dashboard' ? html\`
                <button class="btn-primary" ?disabled=\${s.saving} @click=\${saveConfig}>
                    \${s.saving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
            \` : ''}
        </div>
    \`;
}

tg.ready();
tg.expand();
renderApp();
`;
