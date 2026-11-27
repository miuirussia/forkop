import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dependsOnRoutingAction,
  dependsOnRuleConditions,
  desyncSectionProblem,
  refreshOutboundDetourSectionOptionValues,
} from '../../references';
const get = vi.fn();
beforeEach(() => {
  get.mockReset();
  vi.stubGlobal('uci', {
    get,
    sections: () => [
      { '.name': 'own', action: 'connection', enabled: '1' },
      {
        '.name': 'desync',
        action: 'desync',
        enabled: '1',
        label: 'Direct Desync',
      },
      { '.name': 'disabled', action: 'desync', enabled: '0' },
      { '.name': 'dns', action: 'dns', enabled: '1' },
    ],
  });
});
function map(values: Record<string, unknown>) {
  return {
    lookupOption: (name: string) => [{ formvalue: () => values[name] }, 's1'],
  } as unknown as CBIMap;
}
describe('normal section semantics for Desync', () => {
  it('offers enabled standalone Desync exits and retains all normal routing conditions', () => {
    const option = { value: vi.fn(), depends: vi.fn() } as unknown as CBIOption;
    refreshOutboundDetourSectionOptionValues(option, 'own');
    expect(option.value).toHaveBeenCalledExactlyOnceWith(
      'desync',
      'Direct Desync',
    );
    dependsOnRoutingAction(option);
    expect(option.depends).toHaveBeenCalledWith('action', 'desync');
    dependsOnRuleConditions(option);
    expect(option.depends).toHaveBeenCalledWith({
      action: 'desync',
      destinations: /\S/,
    });
    expect(option.depends).toHaveBeenCalledWith({
      action: 'desync',
      ports: /\S/,
    });
  });
  it('refuses connection sources and cascades without removing them', () => {
    expect(
      desyncSectionProblem(
        map({ action: 'desync', connection_link: ['link1'] }),
        's1',
      ),
    ).not.toBe(true);
    expect(
      desyncSectionProblem(
        map({ action: 'connection', connection_link: ['link1'] }),
        's1',
      ),
    ).toBe(true);
    get.mockImplementation((_: string, _id: string, key: string) =>
      key === 'detour_section' ? 'proxy' : null,
    );
    expect(desyncSectionProblem(map({ action: 'desync' }), 's1')).not.toBe(
      true,
    );
  });
  it('allows a standalone section and ignores removed source values', () => {
    get.mockImplementation((_: string, _id: string, key: string) =>
      key === 'connection_link' ? ['old'] : null,
    );
    expect(
      desyncSectionProblem(
        map({ action: 'desync', connection_link: [] }),
        's1',
      ),
    ).toBe(true);
  });
});
