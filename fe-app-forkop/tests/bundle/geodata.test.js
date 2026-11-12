import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '../lib/luciForm.js';

let harness;
beforeEach(() => {
  harness = createHarness();
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
  it('accepts and saves direct downloads without a connection section', async () => {
    const option = geodata().children.find(
      (item) => item.option === 'geodata_download_section',
    );
    await option.load('settings');
    expect(option.keylist).toContain('');
    expect(option.validate('settings', '')).toBe(true);
    await option.parse('settings');
    expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
  });

  it('keeps unavailable download sections invalid while allowing direct downloads', async () => {
    harness.uci.set(
      'forkop',
      'settings',
      'geodata_download_section',
      'missing',
    );
    const option = geodata().children.find(
      (item) => item.option === 'geodata_download_section',
    );
    await option.load('settings');
    expect(option.validate('settings', 'missing')).not.toBe(true);
    expect(option.validate('settings', '')).toBe(true);
    option.write('settings', '');
    expect(harness.uci.get('forkop', 'settings', option.option)).toBeNull();
  });

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
