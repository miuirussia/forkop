import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

const DEFAULT_HEADERS = ['User-Agent: sing-box/1.14.4'];

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures());
  harness.commands.get_subscription_default_headers = () =>
    Promise.resolve({ code: 0, stdout: JSON.stringify(DEFAULT_HEADERS) });
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
    label: 'Proxy',
  });
});

function subscriptionList() {
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  delete grid.load;
  harness.bundle.createSectionContent(grid);
  return grid.children.find((option) => option.option === 'subscription_url');
}

function paste(list, values, source) {
  const itemId = list.createTypedItem('sec', source);
  const label = list.renderListItemLabel('sec', itemId).textContent;
  values.push(itemId);
  return label;
}

function storeSubscription(id, values) {
  harness.uci.add('forkop', 'subscription_url', id);
  Object.assign(harness.store.get(id), { section: 'sec', ...values });
}

async function openSubscription(id, listed) {
  const list = subscriptionList();
  if (listed) list.formvalue = () => listed;
  const dialog = await harness.openDialog(list, 'sec', id);
  const fields = dialog.map.children[0].children;
  return {
    title: dialog.title,
    field: (name) => fields.find((option) => option.option === name),
    set(name, value) {
      this.field(name).formvalue = () => value;
    },
    setHeaders(headers) {
      dialog.map.data.set(dialog.map.config, 'settings', 'header', headers);
    },
    save: () => dialog.save(),
  };
}

const REMOTE = {
  url: 'https://example.com/sub',
  tag: 'sub1',
  server_filter_mode: 'all',
  subscription_update_enabled: '1',
  subscription_update_interval: '1h',
  download_via_proxy_enabled: '0',
  header: ['User-Agent: custom'],
  show_dashboard_metadata: '1',
};

describe('the subscription list', () => {
  it('shows a pasted subscription by the tag it is given', () => {
    const list = subscriptionList();
    const values = [];
    list.formvalue = () => values.slice();
    const labels = ['https://a.example/sub', '/etc/forkop/b.txt'].map(
      (source) => paste(list, values, source),
    );

    expect(labels).toEqual(['sub1', 'sub2']);
  });

  it('adds the same address twice as two subscriptions', async () => {
    const map = new harness.form.Map('forkop');
    const grid = map.section(harness.form.GridSection, 'section');
    harness.bundle.configureSectionSection(grid);
    harness.bundle.createSectionContent(grid);
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const list = grid.children.find(
      (option) => option.option === 'subscription_url',
    );
    list.cfgvalue('sec', list.load('sec'));
    const values = [];
    list.formvalue = () => values.slice();
    const source = 'https://a.example/sub';

    expect([paste(list, values, source), paste(list, values, source)]).toEqual([
      'sub1',
      'sub2',
    ]);
    await list.parse('sec');

    expect(
      harness.uci
        .sections('forkop', 'subscription_url')
        .map(({ section, url, tag, header }) => ({
          section,
          url,
          tag,
          header,
        })),
    ).toEqual([
      { section: 'sec', url: source, tag: 'sub1', header: DEFAULT_HEADERS },
      { section: 'sec', url: source, tag: 'sub2', header: DEFAULT_HEADERS },
    ]);
  });

  it('shows a stored subscription by its tag', () => {
    storeSubscription('sub_a', { ...REMOTE, tag: 'premium' });

    expect(
      subscriptionList().renderListItemLabel('sec', 'sub_a').textContent,
    ).toBe('premium');
  });

  it.each(['incy://crypt1/a_b-c', 'happ://crypt5/ab:cd'])(
    'leaves the default User-Agent to the router for %s',
    async (url) => {
      const map = new harness.form.Map('forkop');
      const grid = map.section(harness.form.GridSection, 'section');
      harness.bundle.configureSectionSection(grid);
      harness.bundle.createSectionContent(grid);
      grid.cfgsections = () => ['sec'];
      await grid.load();
      const list = grid.children.find(
        (option) => option.option === 'subscription_url',
      );
      list.cfgvalue('sec', list.load('sec'));
      const values = [];
      list.formvalue = () => values.slice();
      paste(list, values, url);
      await list.parse('sec');

      const [stored] = harness.uci.sections('forkop', 'subscription_url');
      expect(stored).toMatchObject({ url, subscription_update_enabled: '1' });
      expect(stored.header ?? []).toEqual([]);
    },
  );
});

describe('the address in the subscription dialog', () => {
  it('moves a subscription to another URL and keeps how it is fetched', async () => {
    storeSubscription('sub_a', REMOTE);
    const dialog = await openSubscription('sub_a');
    expect(dialog.field('url').password, 'the URL is shown masked').toBe(true);
    expect(dialog.title).toBe('Subscription: sub1');
    dialog.set('url', 'https://other.example/sub');

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({
      ...REMOTE,
      url: 'https://other.example/sub',
    });
  });

  it.each([
    ['happ://crypt4/a+/=', 'User-Agent: sing-box/1.13.18', []],
    ['incy://crypt1/a_b-c', 'User-Agent: custom', ['User-Agent: custom']],
  ])(
    'updates the request headers on a switch to %s',
    async (url, agent, kept) => {
      storeSubscription('sub_a', {
        ...REMOTE,
        header: [agent, 'X-HWID: router-hwid'],
      });
      const dialog = await openSubscription('sub_a');
      dialog.set('url', url);

      expect((await dialog.save()).saved).toBe(true);
      expect(harness.store.get('sub_a')).toMatchObject({
        ...REMOTE,
        url,
        header: [...kept, 'X-HWID: router-hwid'],
      });
    },
  );

  it('keeps a User-Agent explicitly set while switching to an encrypted address', async () => {
    storeSubscription('sub_a', { ...REMOTE, header: DEFAULT_HEADERS });
    const dialog = await openSubscription('sub_a');
    const url = 'incy://crypt1/a_b-c';
    const header = ['User-Agent: sing-box/1.12.0'];
    dialog.set('url', url);
    dialog.setHeaders(header);

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({ url, header });
  });

  it('keeps fetch settings when a pasted encrypted address has surrounding spaces', async () => {
    harness.uci.add('forkop', 'section', 'hop');
    Object.assign(harness.store.get('hop'), {
      action: 'connection',
      enabled: '1',
      label: 'Hop',
    });
    const subscription = {
      ...REMOTE,
      url: 'happ://crypt4/a+/=',
      subscription_update_enabled: '0',
      download_via_proxy_enabled: '1',
      download_via_proxy_section: 'hop',
      show_dashboard_metadata: '0',
    };
    delete subscription.subscription_update_interval;
    storeSubscription('sub_a', subscription);
    const dialog = await openSubscription('sub_a');
    const url = 'happ://crypt5/ab:cd';
    dialog.set('url', ` ${url} `);

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({ ...subscription, url });
  });

  it('drops what only a URL is fetched with when it becomes a local file', async () => {
    storeSubscription('sub_a', REMOTE);
    const dialog = await openSubscription('sub_a');
    dialog.set('url', '/etc/forkop/sub.txt');

    expect((await dialog.save()).saved).toBe(true);
    const stored = harness.store.get('sub_a');
    expect(stored.url).toBe('/etc/forkop/sub.txt');
    for (const key of [
      'subscription_update_enabled',
      'subscription_update_interval',
      'download_via_proxy_enabled',
      'header',
      'show_dashboard_metadata',
    ])
      expect(stored[key], key).toBeUndefined();
    expect(stored.tag).toBe('sub1');
  });

  it('gives a local file that becomes a URL the defaults a new one gets', async () => {
    storeSubscription('sub_a', {
      url: '/etc/forkop/sub.txt',
      tag: 'sub1',
      server_filter_mode: 'all',
    });
    const dialog = await openSubscription('sub_a');
    dialog.set('url', 'https://example.com/sub');

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({
      url: 'https://example.com/sub',
      subscription_update_enabled: '1',
      subscription_update_interval: '1h',
      header: DEFAULT_HEADERS,
      show_dashboard_metadata: '1',
    });
  });

  it('drops the default User-Agent when a local file becomes encrypted and other headers are edited', async () => {
    storeSubscription('sub_a', {
      url: '/etc/forkop/sub.txt',
      tag: 'sub1',
      server_filter_mode: 'all',
    });
    const dialog = await openSubscription('sub_a');
    const url = 'incy://crypt1/a_b-c';
    dialog.set('url', url);
    dialog.setHeaders([...DEFAULT_HEADERS, 'X-HWID: router-hwid']);

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({
      url,
      header: ['X-HWID: router-hwid'],
    });
  });

  it('takes the address another subscription of the section has', async () => {
    storeSubscription('sub_a', REMOTE);
    storeSubscription('sub_b', {
      ...REMOTE,
      url: 'https://b.example/sub',
      tag: 'sub2',
    });
    const dialog = await openSubscription('sub_b', ['sub_a', 'sub_b']);
    const check = (value) => dialog.field('url').validate('sub_b', value);

    expect(check('https://example.com/sub')).toBe(true);
    expect(check('https://b.example/sub')).toBe(true);
    expect(check('')).toBe('Required');
  });
});
