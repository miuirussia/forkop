import { FORKOP_UCI_PACKAGE } from '../../constants';

export function configureServerVisibility(
  section: CBISection,
  option: CBIOption,
) {
  let pane: HTMLElement | null = null;
  let contents: Node[] = [];
  let enabled = false;
  const setVisible = (value: boolean) => {
    enabled = value;
    pane?.replaceChildren(...(enabled ? contents : []));
  };
  const parse = section.parse;
  section.parse = function () {
    // Detached fields would otherwise be parsed as missing and removed from UCI.
    return enabled ? parse.call(this) : Promise.resolve();
  };
  const renderContents = section.renderContents;
  section.renderContents = async function (...args) {
    pane = (await renderContents.apply(this, args)) as HTMLElement;
    contents = Array.from(pane.childNodes);
    setVisible(
      uci.get(FORKOP_UCI_PACKAGE, 'settings', 'enable_vpn_server') === '1',
    );
    return pane;
  };
  option.onchange = (_event, sectionId, value) => {
    // Saving a server dialog reloads the map from LuCI's staged UCI values.
    uci.set(
      FORKOP_UCI_PACKAGE,
      sectionId,
      'enable_vpn_server',
      value === '1' ? '1' : '0',
    );
    setVisible(value === '1');
    // LuCI hides empty tab panes and refreshes the menu on dependency changes.
    pane?.dispatchEvent(
      new CustomEvent('dependency-update', { bubbles: true }),
    );
  };
}
