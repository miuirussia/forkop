import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindInlineValidation } from '../validation';

// Only the DOM operations used to present LuCI's real validation events.
function fieldFixture() {
  function node() {
    const attrs = new Map<string, string>();
    return {
      id: '',
      className: '',
      textContent: '',
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name),
      closest: (): unknown => field,
      remove: () => {
        error = null;
      },
    };
  }
  const controls = [node(), node()];
  let error: ReturnType<typeof node> | null = null;
  const field = {
    querySelector: (selector: string) =>
      selector === '.fkp-field-error' ? error : null,
    querySelectorAll: (selector: string) =>
      controls.filter((control) =>
        selector === '.cbi-input-invalid[data-tooltip]'
          ? control.getAttribute('data-tooltip') != null
          : control.getAttribute('aria-errormessage') != null,
      ),
    appendChild: (child: ReturnType<typeof node>) => {
      error = child;
    },
  };
  const root = Object.assign(new EventTarget(), {
    contains: (child: unknown) => child === field,
    querySelectorAll: () => [field],
  });
  vi.stubGlobal('document', { createElement: node });
  const checkDepends = vi.fn();
  return {
    controls,
    checkDepends,
    error: () => error,
    bind: () =>
      bindInlineValidation(
        root as unknown as HTMLElement,
        { checkDepends } as unknown as CBIMap,
      ),
    dispatch: (name: string, index = 0) => {
      const event = new Event(name);
      Object.defineProperty(event, 'target', { value: controls[index] });
      root.dispatchEvent(event);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('inline field validation', () => {
  it('shows an error that LuCI found before the map finished rendering', () => {
    const fixture = fieldFixture();
    fixture.controls[0].setAttribute(
      'data-tooltip',
      'Idle timeout must be at least 1d',
    );

    fixture.bind();

    expect(fixture.error()?.textContent).toBe(
      'Idle timeout must be at least 1d',
    );
    expect(fixture.error()?.getAttribute('aria-live')).toBe('polite');
    expect(fixture.controls[0].getAttribute('aria-invalid')).toBe('true');
    expect(fixture.controls[0].getAttribute('aria-errormessage')).toBe(
      fixture.error()?.id,
    );
  });

  it('updates and removes an error without Save or hovering', () => {
    const fixture = fieldFixture();
    fixture.bind();
    expect(fixture.error()).toBeNull();

    fixture.controls[0].setAttribute('data-tooltip', 'Required');
    fixture.dispatch('validation-failure');
    expect(fixture.error()?.textContent).toBe('Required');

    fixture.controls[0].setAttribute('data-tooltip', 'Invalid port');
    fixture.dispatch('validation-failure');
    expect(fixture.error()?.textContent).toBe('Invalid port');

    fixture.controls[0].removeAttribute('data-tooltip');
    fixture.dispatch('validation-success');
    expect(fixture.error()).toBeNull();
    expect(fixture.controls[0].getAttribute('aria-invalid')).toBeNull();
    expect(fixture.controls[0].getAttribute('aria-errormessage')).toBeNull();
  });

  it('keeps other invalid list entries visible when one entry is fixed', () => {
    const fixture = fieldFixture();
    fixture.controls.forEach((control) =>
      control.setAttribute('data-tooltip', 'Invalid address'),
    );
    fixture.bind();
    expect(fixture.error()?.textContent).toBe('Invalid address');

    fixture.controls[0].removeAttribute('data-tooltip');
    fixture.dispatch('validation-success');
    expect(fixture.error()?.textContent).toBe('Invalid address');
    expect(fixture.controls[0].getAttribute('aria-invalid')).toBeNull();
    expect(fixture.controls[1].getAttribute('aria-invalid')).toBe('true');
  });

  it('rechecks dependent fields during typing and binds a map only once', () => {
    const fixture = fieldFixture();
    fixture.bind();
    fixture.bind();

    fixture.dispatch('input');

    expect(fixture.checkDepends).toHaveBeenCalledOnce();
  });

  it('renders untrusted messages as plain text', () => {
    const fixture = fieldFixture();
    fixture.controls[0].setAttribute(
      'data-tooltip',
      '<img src=x onerror=alert(1)>',
    );
    fixture.bind();

    expect(fixture.error()?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(fixture.error()).not.toHaveProperty('innerHTML');
  });
});
