'use strict';
'require baseclass';
'require dom';
'require form';
'require fs';
'require network';
'require rpc';
'require tools.widgets as widgets';
'require uci';
'require ui';

import './helpers/structuredClonePolyfill';

// view/forkop/forkop.js hands this to view.extend().
export { ForkopView } from './forkop/entry';

// The tab builders, which the bundle checks use to build one tab at a time.
export {
  configureSectionSection,
  createSectionContent,
} from './forkop/tabs/sections';
export {
  configureServerSection,
  createServerContent,
} from './forkop/tabs/servers';
export { createSettingsContent } from './forkop/tabs/settings';
export { createGeodataContent } from './forkop/tabs/geodata';
export { addRuleSetUpdateOptions } from './forkop/tabs/settings/form/updates';
// A check building one tab sets the core features the way ForkopView reads them.
export { setCoreFeatures } from './forkop/services/coreFeatures.service';
