import { FORKOP_UCI_PACKAGE } from '../../constants';

export function configureAutodetectVisibility(
  section: CBISection,
  option: CBIOption,
) {
  let pane: HTMLElement | null = null;
  let contents: Node[] = [];
  const setVisible = (enabled: boolean) => {
    pane?.replaceChildren(...(enabled ? contents : []));
  };
  const renderContents = section.renderContents;
  section.renderContents = async function (...args) {
    pane = (await renderContents.apply(this, args)) as HTMLElement;
    contents = Array.from(pane.childNodes);
    setVisible(
      uci.get(FORKOP_UCI_PACKAGE, 'settings', 'enable_autodetect') === '1',
    );
    return pane;
  };
  option.onchange = (_event, sectionId, value) => {
    uci.set(
      FORKOP_UCI_PACKAGE,
      sectionId,
      'enable_autodetect',
      value === '1' ? '1' : '0',
    );
    setVisible(value === '1');
    pane?.dispatchEvent(
      new CustomEvent('dependency-update', { bubbles: true }),
    );
  };
}
