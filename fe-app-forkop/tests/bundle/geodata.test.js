import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '../lib/luciForm.js';

let harness;
beforeEach(() => {
  harness = createHarness();
  harness.uci.state = { creates: {} };
  harness.uci.add('forkop', 'settings', 'settings');
});

function geodata() {
  const map = new harness.form.Map('forkop');
  harness.bundle.createGeodataContent(map);
  return map.children.find(
    (section) => section.sectiontype === 'geodata_settings',
  );
}

describe('the Geodata tab', () => {
  it('renders source state in the grid and preserves actions in the edit dialog', async () => {
    harness.commands.geodata_status = async () => ({
      code: 0,
      stdout: JSON.stringify({
        sources: [
          {
            id: 'sites',
            ready: true,
            size: 1024,
            tag_count: 12,
            updated_at: 1,
          },
          { id: 'failed', error: 'HTTP 400: missing outbound manager' },
        ],
        job: null,
      }),
    });
    const grid = geodata().children.find(
      (option) => option.option === '_dat_sources',
    ).subsection;
    const state = grid.children.find((option) => option.option === '_state');
    const ready = state.textvalue('sites');
    const missing = state.textvalue('missing');
    const failed = state.textvalue('failed');
    await vi.waitFor(() => expect(ready.textContent).toContain('12 tags'));
    expect(missing.textContent).toBe('Not downloaded');
    expect(failed.textContent).toBe('HTTP 400: missing outbound manager');
    const actions = grid.children.find(
      (option) => option.option === '_actions',
    );
    expect(actions.modalonly).toBe(true);
    expect(
      actions.cfgvalue('sites').childNodes.map((node) => node.textContent),
    ).toEqual(['Update', 'Tags']);
  });

  it.each(['geodata_download_section', 'download_lists_via_proxy_section'])(
    '%s accepts and saves direct downloads without a connection section',
    async (name) => {
      const option = geodata().children.find((item) => item.option === name);
      await option.load('settings');
      expect(option.keylist).toContain('');
      expect(option.validate('settings', '')).toBe(true);
      await option.parse('settings');
      expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
    },
  );

  it.each(['geodata_download_section', 'download_lists_via_proxy_section'])(
    '%s keeps unavailable download sections invalid while allowing direct downloads',
    async (name) => {
      harness.uci.set('forkop', 'settings', 'download_lists_via_proxy', '1');
      harness.uci.set('forkop', 'settings', name, 'missing');
      const option = geodata().children.find((item) => item.option === name);
      await option.load('settings');
      expect(option.validate('settings', 'missing')).not.toBe(true);
      expect(option.validate('settings', '')).toBe(true);
      option.write('settings', '');
      expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
    },
  );

  it('selects list downloads directly in the dropdown and keeps the backend flag in sync', async () => {
    harness.uci.add('forkop', 'section', 'proxy');
    Object.assign(harness.store.get('proxy'), {
      action: 'connection',
      enabled: '1',
      label: 'Proxy',
    });
    const tab = geodata();
    expect(
      tab.children.some((item) => item.option === 'download_lists_via_proxy'),
    ).toBe(false);
    const option = tab.children.find(
      (item) => item.option === 'download_lists_via_proxy_section',
    );
    await option.load('settings');
    expect(option.isActive('settings')).toBe(true);
    expect(option.keylist).toEqual(['proxy', '']);
    expect(option.vallist).toEqual(['Proxy', 'Directly']);

    const formvalue = vi.spyOn(option, 'formvalue').mockReturnValue('proxy');
    await option.parse('settings');
    expect(harness.uci.get('forkop', 'settings', option.option)).toBe('proxy');
    expect(
      harness.uci.get('forkop', 'settings', 'download_lists_via_proxy'),
    ).toBe('1');
    expect(await option.load('settings')).toBe('proxy');
    formvalue.mockRestore();
    await option.parse('settings');
    expect(harness.uci.get('forkop', 'settings', option.option)).toBe('proxy');

    vi.spyOn(option, 'formvalue').mockReturnValue('');
    await option.parse('settings');
    expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
    expect(
      harness.uci.get('forkop', 'settings', 'download_lists_via_proxy'),
    ).toBe('0');
  });

  it.each([undefined, '0'])(
    'keeps list downloads direct when the stored proxy flag is %s',
    async (enabled) => {
      Object.assign(harness.store.get('settings'), {
        download_lists_via_proxy: enabled,
        download_lists_via_proxy_section: 'stale',
      });
      const option = geodata().children.find(
        (item) => item.option === 'download_lists_via_proxy_section',
      );
      expect(await option.load('settings')).toBe('');
      expect(option.keylist).toEqual(['']);
      await option.parse('settings');
      expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
      expect(
        harness.uci.get('forkop', 'settings', 'download_lists_via_proxy'),
      ).toBe('0');
    },
  );

  it('creates sources with explicit names that survive edits and removal of another source', async () => {
    harness.uci.add('forkop', 'geodata', 'older');
    const grid = geodata().children.find(
      (option) => option.option === '_dat_sources',
    ).subsection;
    const add = vi.spyOn(harness.uci, 'add');
    grid.getPreviousModalMap = () => null;
    grid.renderMoreOptionsModal = vi.fn().mockResolvedValue();
    await grid.handleAdd({});
    const id = grid.map.addedSection;
    expect(id).toMatch(/^geodata_[0-9a-f]{6}$/);
    expect(add).toHaveBeenCalledWith('forkop', 'geodata', id);
    expect(grid.renderMoreOptionsModal).toHaveBeenCalledWith(id);
    harness.uci.set('forkop', id, 'label', 'Renamed');
    harness.uci.set('forkop', id, 'input', '/mnt/new.dat');
    harness.uci.remove('forkop', 'older');
    expect(grid.cfgsections()).toEqual([id]);
    expect(harness.uci.get('forkop', id, 'label')).toBe('Renamed');
  });

  it('keeps source URLs and update settings on their own tab', () => {
    const map = new harness.form.Map('forkop');
    const settings = map.section(harness.form.NamedSection, 'settings');
    harness.bundle.createSettingsContent(settings);
    const tab = geodata();
    expect(
      settings.children.some(
        (option) => option.option === 'list_update_enabled',
      ),
    ).toBe(false);
    expect(
      tab.children.some((option) => option.option === 'list_update_enabled'),
    ).toBe(true);
    expect(
      tab.children.some((option) => option.option === 'geodata_path'),
    ).toBe(true);
    const grid = tab.children.find(
      (option) => option.option === '_dat_sources',
    ).subsection;
    expect(grid.sectiontype).toBe('geodata');
    expect(grid.children.some((option) => option.option === 'input')).toBe(
      true,
    );
    expect(
      grid.children.some((option) => option.option === 'auto_update'),
    ).toBe(true);
  });

  it('validates storage, source URLs and bounded update intervals', () => {
    const tab = geodata();
    const path = tab.children.find(
      (option) => option.option === 'geodata_path',
    );
    expect(path.validate('settings', '/mnt/usb/geodata')).toBe(true);
    expect(path.validate('settings', '/')).not.toBe(true);
    expect(path.validate('settings', '/tmp/../etc')).not.toBe(true);
    const grid = tab.children.find(
      (option) => option.option === '_dat_sources',
    ).subsection;
    const input = grid.children.find((option) => option.option === 'input');
    expect(input.modalonly).toBe(true);
    expect(input.validate('source', 'https://example.com/geosite.dat')).toBe(
      true,
    );
    expect(input.validate('source', '/mnt/usb/geosite.dat')).toBe(true);
    expect(input.validate('source', 'relative.dat')).not.toBe(true);
    const interval = grid.children.find(
      (option) => option.option === 'update_interval',
    );
    expect(interval.validate('source', '12h')).toBe(true);
    expect(interval.validate('source', '1m')).not.toBe(true);
  });

  it('preserves a disabled auto-update flag and a source interval on save', async () => {
    harness.uci.add('forkop', 'geodata', 'sites');
    Object.assign(harness.store.get('sites'), {
      label: 'Sites',
      kind: 'geosite',
      input: '/mnt/usb/geosite.dat',
      auto_update: '0',
      update_interval: '12h',
    });
    const tab = geodata();
    const grid = tab.children.find(
      (option) => option.option === '_dat_sources',
    ).subsection;
    await grid.load();
    await Promise.all(
      grid.children
        .filter((option) => option.__name__ !== 'CBI.DummyValue')
        .map((option) => option.parse('sites')),
    );
    expect(harness.uci.get('forkop', 'sites', 'auto_update')).toBe('0');
    expect(harness.uci.get('forkop', 'sites', 'update_interval')).toBe('12h');
    expect(harness.uci.get('forkop', 'sites', 'input')).toBe(
      '/mnt/usb/geosite.dat',
    );
  });
});
