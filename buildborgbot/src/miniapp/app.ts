export function getMiniAppHTML(
  botName: string,
  botKind: string,
  configJson: string,
): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configuración: ${botName}</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script type="module">
        import { html, render } from 'https://unpkg.com/lit-html?module';
        const root = document.getElementById('root');
        const tg = window.Telegram.WebApp;

        const state = {
            name: "${botName}",
            kind: "${botKind}",
            config: ${configJson},
            loading: false,
            error: null
        };

        async function saveConfig() {
            state.loading = true;
            state.error = null;
            render(App(state), root);

            try {
                const slug = window.location.pathname.split('/')[2];
                const response = await fetch(\`/api/miniapp/config?slug=\${slug}\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Telegram-Init-Data': tg.initData
                    },
                    body: JSON.stringify(state.config)
                });

                if (!response.ok) throw new Error('Error al guardar');
                tg.showScanQrPopup({ text: "¡Guardado con éxito!" });
                setTimeout(() => tg.close(), 1500);
            } catch (err) {
                state.error = err.message;
            } finally {
                state.loading = false;
                render(App(state), root);
            }
        }

        function App(s) {
            return html\`
                <div class="container">
                    <h1>\${s.name}</h1>
                    <p>Tipo: <strong>\${s.kind}</strong></p>
                    <div class="field">
                        <label>Configuración JSON</label>
                        <textarea
                            style="height:400px; width: 100%;"
                            @input=\${e => { try { s.config = JSON.parse(e.target.value); } catch(i){} }}
                        >\${JSON.stringify(s.config, null, 2)}</textarea>
                    </div>
                    \${s.error ? html\`<p style="color:red">\${s.error}</p>\` : ''}
                    <button ?disabled=\${s.loading} @click=\${saveConfig}>
                        \${s.loading ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>\`;
        }

        render(App(state), root);
        tg.ready();
        tg.expand();
    </script>
    <style>
        body { font-family: sans-serif; background: var(--tg-theme-bg-color, #fff); color: var(--tg-theme-text-color, #000); padding: 20px; }
        textarea { font-family: monospace; padding: 10px; border-radius: 8px; border: 1px solid #ccc; }
        button {
            width: 100%; padding: 12px; margin-top: 20px;
            background: var(--tg-theme-button-color, #3390ec);
            color: var(--tg-theme-button-text-color, #fff);
            border: none; border-radius: 8px; font-weight: bold; cursor: pointer;
        }
        button:disabled { opacity: 0.5; }
    </style>
</head>
<body><div id="root"></div></body>
</html>`;
}
