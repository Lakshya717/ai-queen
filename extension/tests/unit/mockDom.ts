export class MockElement {
  public tagName: string;
  public className = '';
  public _textContent = '';
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public style: Record<string, string> = {};
  public attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  public get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join(' ');
  }

  public set textContent(val: string) {
    this._textContent = val;
  }

  public get innerHTML(): string {
    return this.children.map((c) => `<${c.tagName}>${c.textContent}</${c.tagName}>`).join('');
  }

  public set innerHTML(val: string) {
    if (val === '') {
      this.children = [];
      this._textContent = '';
    } else {
      // Basic placeholder parser
      this._textContent = val.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  public classList = {
    add: (...tokens: string[]) => {
      const current = new Set(this.className.split(/\s+/).filter(Boolean));
      tokens.forEach((t) => current.add(t));
      this.className = Array.from(current).join(' ');
    },
    remove: (...tokens: string[]) => {
      const current = new Set(this.className.split(/\s+/).filter(Boolean));
      tokens.forEach((t) => current.delete(t));
      this.className = Array.from(current).join(' ');
    },
    contains: (token: string) => {
      return this.className.split(/\s+/).includes(token);
    },
  };

  public appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public removeChild(child: MockElement): MockElement {
    child.remove();
    return child;
  }

  public remove(): void {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public contains(target: MockElement): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  public addEventListener(type: string, listener: (e: unknown) => void): void {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  public querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (node: MockElement) => {
      if (matchesSelector(node, selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        check(child);
      }
    };
    for (const child of this.children) {
      check(child);
    }
    return results;
  }
}

function matchesSelector(node: MockElement, selector: string): boolean {
  if (selector.startsWith('.')) {
    const classes = selector.slice(1).split('.').filter(Boolean);
    return classes.every((cls) => node.classList.contains(cls));
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const attr = selector.slice(1, -1);
    const [name, val] = attr.split('=');
    if (val) {
      const cleanVal = val.replace(/['"]/g, '');
      return node.getAttribute(name) === cleanVal;
    }
    return node.attributes.has(name);
  }
  return node.tagName === selector.toLowerCase();
}

export function setupMockDom(): { document: unknown } {
  const root = new MockElement('html');
  const body = new MockElement('body');
  root.appendChild(body);

  const mockDoc = {
    createElement: (tag: string) => new MockElement(tag),
    body,
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    addEventListener: (_type: string, _listener: (e: unknown) => void) => {},
    removeEventListener: (_type: string, _listener: (e: unknown) => void) => {},
  };

  (globalThis as unknown as { document: unknown }).document = mockDoc;
  return { document: mockDoc };
}
