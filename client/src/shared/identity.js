// Display identity only. Never use this value for dataset IDs or geographic contracts.
export const DISPLAY_NAME = 'SixSim';
export function applyIdentity(study) {
  document.title = `${DISPLAY_NAME} (working name) · ${study}`;
  for (const element of document.querySelectorAll('[data-project-name]')) element.textContent = DISPLAY_NAME;
}
