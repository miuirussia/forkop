export function addGithubOptions(section: Pick<CBISection, 'option'>) {
  const o = section.option(
    form.Value,
    'github_token',
    _('GitHub token'),
    _(
      'Personal access token for component updates and GeoIP/Geosite catalogs. Leave empty to use GitHub without authentication.',
    ),
  );
  o.password = true;
  o.rmempty = true;
  o.validate = (_sectionId: string, value: string) =>
    !value || /^[A-Za-z0-9_]+$/.test(value.trim())
      ? true
      : _('The token must contain only letters, digits and underscores.');
  o.write = function (sectionId: string, value: string) {
    return uci.set(this.map.config, sectionId, this.option, value.trim());
  };
}
