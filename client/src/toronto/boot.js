import { applyIdentity } from './identity.js';
applyIdentity('Queen & Spadina massing study');
const status = document.querySelector('#status');
const reload = document.querySelector('#reload');
const controls = ['#plan', '#perspective'].map(id => document.querySelector(id));
reload.onclick = () => location.reload();
export function showFailure(error) {
  status.textContent = `Unable to display study: ${error.message || 'Check your connection and reload.'}`;
  status.setAttribute('role', 'alert');
  for (const control of controls) control.disabled = true;
  reload.hidden = false;
}
try {
  const { start } = await import('./main.js');
  await start(showFailure);
  for (const control of controls) control.disabled = false;
} catch (error) { showFailure(error); }
