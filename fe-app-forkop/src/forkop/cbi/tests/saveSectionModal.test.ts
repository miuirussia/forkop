import { beforeEach, describe, expect, it, vi } from 'vitest';

const toasts: Array<[string, string]> = [];

vi.mock('../../../helpers/showToast', () => ({
  showToast: (message: string, type: string) => {
    toasts.push([message, type]);
  },
}));

import { reportRefusedSave, saveSectionModal } from '../modal';

function dialog(save: () => Promise<void>, markedField: unknown = null) {
  const calls: string[] = [];
  const record = (call: string) => {
    calls.push(call);
    return Promise.resolve();
  };
  const page = {
    load: () => record('page.load'),
    reset: () => record('page.reset'),
  };
  const modalMap = {
    save: (_cb: unknown, silent: boolean) =>
      record(`modal.save silent=${silent}`).then(save),
    parent: page,
  };
  const modalNode = {
    querySelector: (selector: string) =>
      selector === '.cbi-input-invalid' ? markedField : null,
  };
  const sectionRef = {
    getActiveModalMap: () => modalNode,
    handleModalCancel: (map: unknown, _ev: Event, isSaving: boolean) =>
      record(`cancel ${map === modalMap} saving=${isSaving}`),
  };
  (globalThis as unknown as { dom: unknown }).dom = {
    findClassInstance: (node: unknown) =>
      node === modalNode ? modalMap : null,
  };
  return { calls, modalMap, sectionRef: sectionRef as unknown as CBISection };
}

beforeEach(() => {
  toasts.length = 0;
});

describe('saving a section dialog', () => {
  it('saves, reloads the page it came from and closes', async () => {
    const { calls, modalMap, sectionRef } = dialog(() => Promise.resolve());

    const saved = await saveSectionModal(
      sectionRef,
      modalMap as unknown as CBIMap,
      {} as Event,
    );

    expect(saved).toBe(true);
    expect(calls).toEqual([
      'modal.save silent=true',
      'page.load',
      'page.reset',
      'cancel true saving=true',
    ]);
    expect(toasts).toEqual([]);
  });

  it('stays open on a refusal and says why', async () => {
    const { calls, modalMap, sectionRef } = dialog(() =>
      Promise.reject(new TypeError('Option "Port" must not be empty.')),
    );

    const saved = await saveSectionModal(
      sectionRef,
      modalMap as unknown as CBIMap,
      {} as Event,
    );

    expect(saved).toBe(false);
    expect(calls).toEqual(['modal.save silent=true']);
    expect(toasts).toEqual([['Option "Port" must not be empty.', 'error']]);
  });

  it('shows the reason even when LuCI already marked the field', async () => {
    const reason = 'Idle timeout must be at least the check interval (1d)';
    const field = {
      getAttribute: (name: string) => (name === 'data-tooltip' ? reason : null),
      focus: vi.fn(),
      closest: () => null,
    };
    const { modalMap, sectionRef } = dialog(
      () =>
        Promise.reject(
          new TypeError('Option "Port" contains an invalid input value.'),
        ),
      field,
    );

    const saved = await saveSectionModal(
      sectionRef,
      modalMap as unknown as CBIMap,
      {} as Event,
    );

    expect(saved).toBe(false);
    expect(toasts).toEqual([[reason, 'error']]);
    expect(field.focus).toHaveBeenCalledOnce();
  });

  it('shows a fallback when the save refuses without a reason', () => {
    reportRefusedSave(undefined);

    expect(toasts).toEqual([['Settings not saved', 'error']]);
  });

  it('keeps the save error when the marked field has no tooltip', () => {
    const field = {
      getAttribute: () => null,
      focus: vi.fn(),
      closest: () => null,
    };
    const node = { querySelector: () => field } as unknown as ParentNode;

    reportRefusedSave(new Error('Invalid idle timeout'), node);

    expect(toasts).toEqual([['Invalid idle timeout', 'error']]);
  });
});
