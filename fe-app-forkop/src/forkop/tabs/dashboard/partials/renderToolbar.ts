import { renderButton } from '../../../../partials';
import { renderGaugeIcon24, renderRotateCcwIcon24 } from '../../../../icons';
import { E } from '../../../../helpers/element';

interface IToolbarAction {
  busy: boolean;
  onClick: () => void;
}

interface IRenderToolbarProps {
  testAll?: IToolbarAction;
  updateSubscriptions?: IToolbarAction;
}

export function renderToolbar({
  testAll,
  updateSubscriptions,
}: IRenderToolbarProps): HTMLElement[] {
  const actions = [
    testAll &&
      renderButton({
        classNames: ['fkp_dashboard-page__toolbar__action'],
        icon: renderGaugeIcon24,
        text: _('Test all sections'),
        loading: testAll.busy,
        onClick: testAll.onClick,
      }),
    updateSubscriptions &&
      renderButton({
        classNames: ['fkp_dashboard-page__toolbar__action'],
        icon: renderRotateCcwIcon24,
        text: _('Update subscriptions'),
        loading: updateSubscriptions.busy,
        onClick: updateSubscriptions.onClick,
      }),
  ].filter((action): action is HTMLButtonElement => Boolean(action));

  return actions.length
    ? [E('div', { class: 'fkp_dashboard-page__toolbar' }, actions)]
    : [];
}
