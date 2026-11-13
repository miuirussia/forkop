import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/singGeo.service', () => ({
  loadSingGeositeFiles: vi.fn(),
  loadSingGeoipFiles: vi.fn(),
  SING_GEOIP_URL:
    'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/',
  SING_GEOSITE_URL:
    'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/',
}));
import {
  loadSingGeositeFiles,
  loadSingGeoipFiles,
  SING_GEOSITE_URL,
  SING_GEOIP_URL,
} from '../../../services/singGeo.service';
import { showSagerNetCatalog } from '../sagerNetCatalog';

// Only the catalog's DOM boundary is stubbed; filtering, paging and selection run unchanged.
class Node {
  value = '';
  disabled = false;
  scrollTop = 0;
  textContent = '';
  listeners: Record<string, () => void> = {};
  focus = vi.fn();
  constructor(
    public attrs: Record<string, unknown>,
    public children: Node[] = [],
  ) {}
  addEventListener(event: string, handler: () => void) {
    this.listeners[event] = handler;
  }
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  get status() {
    return this.children[2];
  }
  get rows() {
    return this.children[3].children;
  }
  get controls() {
    return this.children[4].children;
  }
  get search() {
    return this.children[1].children[1];
  }
  get source() {
    return this.children[1].children[0];
  }
}
let content: Node;
let opener: { focus: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  opener = { focus: vi.fn() };
  vi.stubGlobal('document', {
    activeElement: opener,
    querySelector: () => null,
  });
  vi.stubGlobal(
    'E',
    (tag: string, attrs: Record<string, unknown>, children: Node[]) => {
      const node = new Node(attrs ?? {}, children ?? []);
      if (tag === 'select') node.value = String(children[0].attrs.value);
      return node;
    },
  );
  vi.spyOn(ui, 'showModal').mockImplementation((_title, nodes) => {
    content = (Array.isArray(nodes) ? nodes[0] : nodes) as unknown as Node;
    return content as unknown as HTMLElement;
  });
  vi.spyOn(ui, 'hideModal').mockImplementation(() => undefined);
  vi.mocked(loadSingGeositeFiles).mockResolvedValue([
    'geosite-reddit.srs',
    'geosite-telegram.srs',
  ]);
  vi.mocked(loadSingGeoipFiles).mockResolvedValue(['geoip-ru.srs']);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function click(node: Node) {
  (node.attrs.click as () => void)();
}
function search(query: string) {
  content.search.value = query;
  content.search.listeners.input();
}

describe('SagerNet catalog', () => {
  it('opens before loading, selects raw URLs and restores focus', async () => {
    let resolve!: (files: string[]) => void;
    vi.mocked(loadSingGeositeFiles).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const select = vi.fn();
    const pending = showSagerNetCatalog(true, select, () => []);
    expect(content.status.children).toEqual(['Loading…']);
    expect(content.rows).toHaveLength(0);
    resolve(['geosite-reddit.srs']);
    await pending;
    // LuCI stringifies false attributes, so disabled must be omitted with null.
    expect(content.rows[0].children[1].attrs.disabled).toBeNull();
    click(content.rows[0].children[1]);
    expect(select).toHaveBeenCalledWith(
      SING_GEOSITE_URL + 'geosite-reddit.srs',
    );
    expect(ui.hideModal).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it('searches, marks selected entries and offers GeoIP for routing', async () => {
    const select = vi.fn();
    await showSagerNetCatalog(true, select, () => [
      SING_GEOSITE_URL + 'geosite-reddit.srs',
    ]);
    expect(content.rows[0].children[1].attrs.disabled).toBe('');
    search('TELE');
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0].children[0].children).toEqual(['telegram']);
    search('no-match');
    expect(content.status.textContent).toBe('No matching rule sets');
    search('');
    content.source.value = 'geoip';
    content.source.listeners.change();
    click(content.rows[0].children[1]);
    expect(select).toHaveBeenCalledWith(SING_GEOIP_URL + 'geoip-ru.srs');
  });

  it('never loads or offers GeoIP for DNS', async () => {
    await showSagerNetCatalog(false, vi.fn(), () => []);
    expect(loadSingGeoipFiles).not.toHaveBeenCalled();
    expect(content.source.children).toHaveLength(1);
  });

  it('pages large catalogs and resets the page on search', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue(
      Array.from({ length: 401 }, (_, index) => `geosite-test-${index}.srs`),
    );
    await showSagerNetCatalog(true, vi.fn(), () => []);
    expect(content.rows).toHaveLength(200);
    expect(content.status.textContent).toBe('1–200 / 401');
    content.controls[1].listeners.click();
    expect(content.status.textContent).toBe('201–400 / 401');
    search('test-400');
    expect(content.status.textContent).toBe('1–1 / 1');
    expect(content.controls[0].disabled).toBe(true);
    expect(content.controls[1].disabled).toBe(true);
  });

  it('reports an unavailable catalog and keeps the other source usable', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue([]);
    await showSagerNetCatalog(true, vi.fn(), () => []);
    expect(content.status.textContent).toContain('Could not load');
    content.source.value = 'geoip';
    content.source.listeners.change();
    expect(content.rows).toHaveLength(1);
  });

  it('ignores results arriving after closing during loading', async () => {
    let resolve!: (files: string[]) => void;
    vi.mocked(loadSingGeositeFiles).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = showSagerNetCatalog(true, vi.fn(), () => []);
    click(content.controls[2]);
    resolve(['geosite-reddit.srs']);
    await pending;
    expect(content.rows).toHaveLength(0);
  });
});
