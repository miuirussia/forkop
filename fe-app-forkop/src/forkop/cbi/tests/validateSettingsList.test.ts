import { describe, expect, it, vi } from 'vitest';

import { validateSettingsList } from '../dynamicList';

function list() {
  return {
    validate: () => true,
    validateItemsOnSave: vi.fn((): true | string => 'Group: fix its settings'),
    childType: 'urltest',
    childOwner: () => 'section',
    formvalue: () => ['group'],
    cfgvalue: () => ['stored-group'],
  };
}

describe('child settings validated by the live list widget', () => {
  it('reports invalid child settings before Save and clears after they are fixed', () => {
    const option = list();
    const check = () =>
      validateSettingsList(
        option as unknown as Parameters<typeof validateSettingsList>[0],
        'settings',
        '',
      );

    expect(check()).toBe('Group: fix its settings');
    expect(option.validateItemsOnSave).toHaveBeenCalledWith(
      'section',
      ['group'],
      option,
      'settings',
    );
    option.validateItemsOnSave.mockReturnValue(true);
    expect(check()).toBe(true);
  });

  it('keeps the specific error for a malformed entry', () => {
    const option = { ...list(), validate: () => 'Invalid URL' };

    expect(
      validateSettingsList(
        option as unknown as Parameters<typeof validateSettingsList>[0],
        'settings',
        'bad',
      ),
    ).toBe('Invalid URL');
    expect(option.validateItemsOnSave).not.toHaveBeenCalled();
  });
});
