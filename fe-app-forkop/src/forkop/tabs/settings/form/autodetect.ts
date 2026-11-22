import { portField, wholeNumberField } from '../../../../validators/fields';
import { required, requiredList } from '../../../cbi/required';
import { configureDownloadSectionOption } from '../sectionChoices';

export function addAutodetectOptions(section: Pick<CBISection, 'option'>) {
  let o = section.option(
    form.Flag,
    'enable_autodetect',
    _('Enable Autodetect'),
    _('Check HTTPS access directly and through the selected section.'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.ListValue,
    'autodetect_proxy_section',
    _('Autodetect comparison section'),
    _('Compare direct HTTPS access with access through this section'),
  );
  configureDownloadSectionOption(o, 'autodetect_proxy_section');
  o.depends('enable_autodetect', '1');
  o.retain = true;

  o = section.option(
    form.DynamicList,
    'autodetect_ports',
    _('HTTPS ports'),
    _('TCP ports to monitor, one per entry. Default: 443.'),
  );
  o.default = ['443'];
  o.datatype = 'port';
  o.validate = requiredList(portField);
  o.depends('enable_autodetect', '1');
  o.retain = true;

  const fields = [
    {
      key: 'autodetect_timeout',
      title: _('Request timeout (seconds)'),
      value: 8,
      min: 1,
      max: 60,
    },
    {
      key: 'autodetect_confirmations',
      title: _('Consecutive confirmations'),
      value: 2,
      min: 1,
      max: 5,
    },
    {
      key: 'autodetect_stall_timeout',
      title: _('Stall threshold (seconds)'),
      value: 9,
      min: 3,
      max: 300,
    },
    {
      key: 'autodetect_response_limit',
      title: _('Probe response limit (KiB)'),
      value: 64,
      min: 1,
      max: 1024,
    },
    {
      key: 'autodetect_recheck_interval',
      title: _('Recheck interval (minutes)'),
      value: 15,
      min: 1,
      max: 1440,
    },
    {
      key: 'autodetect_history_limit',
      title: _('Result history size'),
      value: 100,
      min: 10,
      max: 100,
    },
  ];
  for (const field of fields) {
    o = section.option(form.Value, field.key, field.title);
    o.default = `${field.value}`;
    o.datatype = `range(${field.min},${field.max})`;
    o.validate = required(wholeNumberField(field.min, field.max));
    o.depends('enable_autodetect', '1');
    o.retain = true;
  }
}
