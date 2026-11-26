import { E } from '../../../helpers/element';
import { addDnsOptions } from './form/dns';
import { addAutodetectOptions } from './form/autodetect';
import { addGithubOptions } from './form/github';
import { addNetworkOptions } from './form/network';
import { addServiceOptions } from './form/service';
import { addTrafficOptions, addYacdOptions } from './form/traffic';
import { addLatencyOptions, addWarpOptions } from './form/updates';

export function createSettingsContent(section: CBISection) {
  const groups = [
    { id: 'dns', title: _('DNS'), add: [addDnsOptions] },
    {
      id: 'network',
      title: _('Network'),
      add: [addNetworkOptions, addWarpOptions],
    },
    { id: 'traffic', title: _('Traffic'), add: [addTrafficOptions] },
    { id: 'yacd', title: 'YACD', add: [addYacdOptions] },
    { id: 'github', title: 'Github API', add: [addGithubOptions] },
    {
      id: 'latency',
      title: _('Latency measurement'),
      add: [addLatencyOptions],
    },
    { id: 'service', title: _('Service'), add: [addServiceOptions] },
    { id: 'autodetect', title: 'Autodetect', add: [addAutodetectOptions] },
  ];
  for (const { id, title, add } of groups) {
    const tab = `settings-${id}`;
    section.tab(tab, title);
    const fields = { option: section.taboption.bind(section, tab) };
    add.forEach((addOptions) => addOptions(fields));
  }

  // LuCI inserts the category menu immediately before its tab panels.
  const renderContents = section.renderContents;
  section.renderContents = async function (...args) {
    const node = (await renderContents.apply(this, args)) as HTMLElement;
    const body = node.querySelector(':scope > .cbi-section-node-tabbed');
    if (!body) return node;
    const layout = E('div', { class: 'fkp-settings__layout' });
    body.before(layout);
    layout.appendChild(body);
    // LuCI dispatches the selection event on the pane without bubbling.
    layout.addEventListener(
      'cbi-tab-active',
      (event) => {
        const pane = event.target as HTMLElement;
        if (pane.parentElement !== body) return;
        const links = layout.querySelectorAll<HTMLAnchorElement>(
          ':scope > .cbi-tabmenu > li > a',
        );
        for (const link of links) {
          if (link.parentElement?.dataset.tab === pane.dataset.tab) {
            link.setAttribute('aria-current', 'true');
          } else {
            link.removeAttribute('aria-current');
          }
        }
      },
      true,
    );
    node.classList.add('fkp-settings');
    return node;
  };
}
