import {
  PHOBOS_MASKING_MODES,
  parsePhobosLink,
  withPhobosLinkMasking,
} from '../../../helpers/parseWireGuardConfig';
import { validateCoreFeature } from '../../services/coreFeatures.service';
import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getProxyUrlName } from '../../../helpers/getProxyUrlName';
import { nextNumberedName } from '../../../helpers/nextNumberedName';
import { validateProxyUrl } from '../../../validators/validateProxyUrl';
import { getChildItemIds, isExistingChildItem } from '../../cbi/childItems';
import { updateDynamicListItemLabel } from '../../cbi/listItems';
import {
  setModalOptionValue,
  showChildItemSettingsModal,
} from '../../cbi/modal';
import { required } from '../../cbi/required';
import { E } from '../../../helpers/element';
import { addCascadeOptions } from './cascade';
import { validateConnectionUriCore } from './coreSupport';
import {
  refreshLiveChoiceWidgets,
  sectionChildNames,
  validateSectionChildListName,
} from './outboundNames';

export function validateConnectionLink(value: unknown) {
  const link = `${value ?? ''}`.trim();
  if (!link) {
    return true;
  }

  if (/^phobos:\/\//iu.test(link)) {
    const parsed = parsePhobosLink(link);
    return parsed.valid ? validateCoreFeature('wireguard') : parsed.message;
  }
  const validation = validateProxyUrl(link);
  return validation === true ? validateConnectionUriCore(link) : validation;
}

// As the dialog holds them now, or the stored links when the list is not on screen.
function listedLinkValues(sectionId: string, option: CBIOption): string[] {
  let values: unknown = null;
  try {
    values = option && option.formvalue ? option.formvalue(sectionId) : null;
  } catch (_error) {
    values = null;
  }

  return Array.isArray(values)
    ? values.map((value) => `${value || ''}`.trim()).filter(Boolean)
    : getChildItemIds(sectionId, 'connection_link');
}

// A link still in the add field is no entry yet and holds no name.
function listedLinkName(sectionId: string, value: string) {
  return isExistingChildItem(sectionId, value, 'connection_link')
    ? `${uci.get(FORKOP_UCI_PACKAGE, value, 'name') || ''}`.trim()
    : '';
}

// Named after the server it describes ("／" for "/"), or "Node #N"; a name the section already
// holds gets "#1" and up, so the same link added twice is two servers.
export function nextLinkName(
  sectionId: string,
  option: CBIOption,
  link: string,
) {
  const linkNames = listedLinkValues(sectionId, option)
    .map((value) => listedLinkName(sectionId, value))
    .filter(Boolean);
  const taken = new Set([
    ...linkNames,
    ...sectionChildNames(sectionId)
      .filter((child) => child.kind !== 'link')
      .map((child) => child.name),
  ]);
  const fragment = getProxyUrlName(link).trim().replaceAll('/', '／');
  const own =
    /^phobos:\/\//iu.test(link) && fragment === 'none' ? '' : fragment;
  if (own && !taken.has(own)) {
    return own;
  }
  return nextNumberedName(own || 'Node', [...taken]);
}

export function connectionLinkListItemLabel(sectionId: string, value: string) {
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    listedLinkName(sectionId, value),
  );
}

function connectionLinkSettingsKeys() {
  return ['name', 'uri', 'detour_section'];
}

function writeTrimmed(this: CBIOption, itemId: string, value: unknown) {
  return form.Value.prototype.write.call(this, itemId, `${value ?? ''}`.trim());
}

export function showConnectionLinkSettingsModal(
  sectionId: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
) {
  const name = listedLinkName(sectionId, `${itemValue ?? ''}`);
  return showChildItemSettingsModal(sectionId, itemValue, option, {
    typeName: 'connection_link',
    valueOption: 'uri',
    keys: connectionLinkSettingsKeys(),
    itemNode,
    defaults: (inputValue: string) => ({ uri: inputValue, name }),
    addOptions: (itemSection: CBISection) => {
      const o = itemSection.option(form.Value, 'name', _('Server name'));
      o.write = writeTrimmed;
      o.validate = required(function (_itemId, value) {
        return validateSectionChildListName(
          sectionId,
          'link',
          widget,
          itemNode,
          value,
        );
      });

      const uri = itemSection.option(form.Value, 'uri', _('Connection URI'));
      // A link carries the credentials of its server.
      uri.password = true;
      // Masking updates the JSON data before save; always persist the visible URI.
      uri.forcewrite = true;
      uri.write = writeTrimmed;
      uri.validate = required((_itemId, value) =>
        validateConnectionLink(value),
      );

      const masking = itemSection.option(
        form.ListValue,
        'phobos_masking',
        _('Masking type'),
      );
      masking.depends('uri', /^\s*phobos:\/\//iu);
      masking.value('', _('Default'));
      PHOBOS_MASKING_MODES.forEach((mode) =>
        masking.value(mode, mode === 'NONE' ? _('None') : mode),
      );
      masking.load = function (itemId: string) {
        const parsed = parsePhobosLink(
          `${this.map.data.get(this.map.config, itemId, 'uri') || ''}`,
        );
        return parsed.valid ? parsed.endpoint.obfuscation.masking || '' : '';
      };
      // The selection is carried inside the URI, not in a separate UCI option.
      masking.write = function () {};
      masking.remove = function () {};
      masking.onchange = (_event, itemId, value) => {
        const link = `${uri.formvalue(itemId) || ''}`;
        let updated: string;
        try {
          updated = withPhobosLinkMasking(link, `${value || ''}`);
        } catch {
          return;
        }
        setModalOptionValue(itemSection.map, uri, updated);
      };
      uri.onchange = (_event, _itemId, value) => {
        const parsed = parsePhobosLink(`${value || ''}`);
        setModalOptionValue(
          itemSection.map,
          masking,
          parsed.valid ? parsed.endpoint.obfuscation.masking || '' : '',
        );
      };

      addCascadeOptions(
        itemSection,
        () => sectionId,
        _('Connect to the server through another section'),
      );
    },
    title: () => (name ? _('Server: %s').format(name) : _('Server settings')),
    afterSave: (
      _itemId: string,
      _inputValue: string,
      settings: ChildSettings,
    ) => {
      updateDynamicListItemLabel(itemNode, `${settings.name || ''}`.trim());
      refreshLiveChoiceWidgets(sectionId);
    },
  });
}
