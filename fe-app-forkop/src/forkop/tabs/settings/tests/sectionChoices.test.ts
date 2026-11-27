import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureDirectDownloadSectionOption,
  configureDownloadSectionOption,
} from '../sectionChoices';

const sections = {
  proxy: { '.type': 'section', '.name': 'proxy', action: 'connection' },
  dpi: { '.type': 'section', '.name': 'dpi', action: 'desync', label: 'DPI' },
  disabled: {
    '.type': 'section',
    '.name': 'disabled',
    action: 'desync',
    enabled: '0',
  },
  bypass: { '.type': 'section', '.name': 'bypass', action: 'bypass' },
  dns: { '.type': 'section', '.name': 'dns', action: 'dns' },
  other: { '.type': 'server', '.name': 'other', action: 'desync' },
};
const get = vi.fn();
beforeEach(() => {
  get.mockReset().mockReturnValue('');
  vi.stubGlobal('uci', { get, sections: () => Object.values(sections) });
});

function option() {
  return {
    map: { data: { state: { values: { forkop: sections } } } },
    value(this: CBIOption, key: string, label: string) {
      this.keylist!.push(key);
      this.vallist!.push(label);
    },
  } as unknown as CBIOption;
}

describe('shared global section choices', () => {
  it.each(['dns_detour_section', 'download_lists_via_proxy_section'])(
    'offers eligible Desync exits for %s',
    (name) => {
      const field = option();
      configureDownloadSectionOption(field, name);
      field.load('settings');
      expect(field.keylist).toEqual(['proxy', 'dpi']);
      expect(field.vallist).toEqual(['proxy', 'DPI']);
      expect(field.validate('settings', 'dpi')).toBe(true);
    },
  );
  it('keeps a disabled stored choice visible but invalid and preserves Directly', () => {
    get.mockReturnValue('disabled');
    const field = option();
    configureDirectDownloadSectionOption(
      field,
      'download_lists_via_proxy_section',
    );
    field.load('settings');
    expect(field.keylist).toEqual(['proxy', 'dpi', 'disabled', '']);
    expect(field.validate('settings', 'disabled')).not.toBe(true);
    expect(field.validate('settings', '')).toBe(true);
  });
});
