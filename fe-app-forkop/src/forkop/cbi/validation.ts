// Keep LuCI's validation rules and expose their tooltip messages below each field.
const boundMaps = new WeakSet<HTMLElement>();
let errorId = 0;

export function renderFieldErrors(field: HTMLElement) {
  const invalid = Array.from(
    field.querySelectorAll<HTMLElement>('.cbi-input-invalid[data-tooltip]'),
  );
  const messages = [
    ...new Set(
      invalid
        .map((node) => node.getAttribute('data-tooltip')?.trim())
        .filter(Boolean),
    ),
  ];
  let error = field.querySelector<HTMLElement>('.fkp-field-error');

  if (!error && !messages.length) return;
  if (!error) {
    error = document.createElement('div');
    error.id = `fkp-field-error-${++errorId}`;
    error.className = 'fkp-field-error';
    error.setAttribute('aria-live', 'polite');
    error.setAttribute('aria-atomic', 'true');
    (field.querySelector('.cbi-value-field') || field).appendChild(error);
  }

  field
    .querySelectorAll<HTMLElement>(`[aria-errormessage="${error.id}"]`)
    .forEach((node) => {
      if (!invalid.includes(node)) {
        node.removeAttribute('aria-invalid');
        node.removeAttribute('aria-errormessage');
      }
    });
  if (!messages.length) {
    error.remove();
    return;
  }
  const text = messages.join('\n');
  if (error.textContent !== text) error.textContent = text;
  invalid.forEach((node) => {
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-errormessage', error.id);
  });
}

export function bindInlineValidation(root: HTMLElement, map: CBIMap) {
  if (boundMaps.has(root)) return;
  boundMaps.add(root);

  const update = (event: Event) => {
    const field = (event.target as Element).closest<HTMLElement>(
      '[data-field]',
    );
    if (field && root.contains(field)) renderFieldErrors(field);
  };
  root.addEventListener('validation-failure', update);
  root.addEventListener('validation-success', update);
  // LuCI rechecks dependent fields on change (usually blur). Check during typing too,
  // so changing the interval also updates the error under the untouched idle timeout.
  root.addEventListener('input', (event) => {
    if ((event.target as Element).closest('[data-field]')) map.checkDepends();
  });
  // Rendering already ran the validators before these listeners were attached.
  root.querySelectorAll<HTMLElement>('[data-field]').forEach(renderFieldErrors);
}
