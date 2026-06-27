export const stylesCSS = `
:root {
  --tg-theme-bg-color: #ffffff;
  --tg-theme-text-color: #222222;
  --tg-theme-button-color: #3390ec;
  --tg-theme-button-text-color: #ffffff;
  --tg-theme-secondary-bg-color: #f4f4f5;
  --tg-theme-hint-color: #707579;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--tg-theme-bg-color);
  color: var(--tg-theme-text-color);
}

.container {
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  font-size: 20px;
  margin-bottom: 24px;
  text-align: center;
}

.tabs {
  display: flex;
  background: var(--tg-theme-secondary-bg-color);
  padding: 4px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.tabs button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--tg-theme-text-color);
  font-weight: 500;
}

.tabs button.active {
  background: var(--tg-theme-bg-color);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.card {
  background: var(--tg-theme-secondary-bg-color);
  padding: 12px;
  border-radius: 10px;
  margin-bottom: 12px;
}

.form-group {
  margin-bottom: 16px;
}

label {
  display: block;
  font-size: 14px;
  margin-bottom: 6px;
  font-weight: 600;
}

input, textarea, select {
  width: 100%;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 16px;
}

.btn-primary {
  width: 100%;
  background: var(--tg-theme-button-color);
  color: var(--tg-theme-button-text-color);
  border: none;
  padding: 12px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 20px;
}

.btn-danger {
  background: #ff4d4f;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.options-list {
  margin-top: 8px;
  padding-left: 20px;
}

.option-item {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.step-card {
  border: 1px solid #eee;
  padding: 15px;
  margin-bottom: 15px;
  border-radius: 12px;
  background: #fff;
}
`;
