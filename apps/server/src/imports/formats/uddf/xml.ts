// A small XML reader for UDDF (ADR 0003): elements, attributes, text, CDATA, comments and processing instructions.
// A document type is refused, so nothing expands entities or reaches outside the file; namespace prefixes are dropped,
// as the UDDF reader accepts any namespace.

export class XmlError extends Error {
  override name = 'XmlError';
}

export interface XmlElement {
  /** The local name, without a namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The element's own text (not its children's), trimmed. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const MAX_DEPTH = 64;
/** A real logbook of 32 MB has well under a million elements; more would only fill the memory. */
const MAX_ELEMENTS = 1_000_000;

const localName = (qualified: string) => qualified.slice(qualified.indexOf(':') + 1);

function decode(raw: string): string {
  return raw.replace(/&([^;\s&]*);?/g, (match, ref: string) => {
    if (!match.endsWith(';')) throw new XmlError(`Unterminated reference: ${match}`);
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) throw new XmlError(`Invalid character reference: ${match}`);
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(ENTITIES, ref)) throw new XmlError(`Unknown entity: ${match}`);
    return ENTITIES[ref]!;
  });
}

const NAME = /^[A-Za-z_][\w.:-]*/;
const ATTRIBUTE = /^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/;

type Open = { element: XmlElement; text: string[]; qualified: string };

class Reader {
  i: number;
  readonly stack: Open[] = [];
  private elements = 0;
  root: XmlElement | undefined;
  constructor(readonly source: string, private readonly maxElements: number) { this.i = source.charCodeAt(0) === 0xfeff ? 1 : 0; }

  read(): XmlElement {
    while (this.i < this.source.length) this.step();
    if (this.stack.length > 0) throw new XmlError(`Unclosed element <${this.stack.at(-1)!.qualified}>`);
    if (!this.root) throw new XmlError('No root element');
    return this.root;
  }

  private step() {
    const { source, i } = this;
    if (source[i] !== '<') this.text();
    else if (source.startsWith('<!--', i)) this.skip(4, '-->', 'comment');
    else if (source.startsWith('<?', i)) this.skip(2, '?>', 'processing instruction');
    else if (source.startsWith('<![CDATA[', i)) this.cdata();
    else if (source.startsWith('<!', i)) throw new XmlError('A document type is not accepted');
    else if (source.startsWith('</', i)) this.close();
    else this.open();
  }

  private skip(from: number, end: string, what: string): string {
    this.i += from;
    const at = this.source.indexOf(end, this.i);
    if (at < 0) throw new XmlError(`Unterminated ${what}`);
    const inner = this.source.slice(this.i, at);
    this.i = at + end.length;
    return inner;
  }

  private text() {
    const lt = this.source.indexOf('<', this.i);
    const end = lt < 0 ? this.source.length : lt;
    const raw = this.source.slice(this.i, end);
    this.i = end;
    if (this.stack.length > 0) this.stack.at(-1)!.text.push(decode(raw));
    else if (raw.trim()) throw new XmlError('Text outside the root element');
  }

  private cdata() {
    const data = this.skip(9, ']]>', 'CDATA section');
    if (this.stack.length === 0) throw new XmlError('CDATA outside the root element');
    this.stack.at(-1)!.text.push(data);
  }

  private name(): string | undefined {
    return NAME.exec(this.source.slice(this.i, this.i + 256))?.[0];
  }

  private close() {
    this.i += 2;
    const name = this.name();
    const open = this.stack.pop();
    if (!name || open?.qualified !== name) throw new XmlError(`Unexpected closing tag </${name ?? ''}>`);
    this.skip(name.length, '>', 'closing tag');
    open.element.text = open.text.join('').trim();
  }

  private open() {
    if (++this.elements > this.maxElements) throw new XmlError('A document with too many elements');
    this.i += 1;
    const qualified = this.name();
    if (!qualified) throw new XmlError('Invalid tag');
    this.i += qualified.length;
    const element: XmlElement = { name: localName(qualified), attributes: {}, children: [], text: '' };
    this.attributes(element, qualified);
    const selfClosing = this.source.startsWith('/>', this.i);
    this.i += selfClosing ? 2 : 1;
    if (this.stack.length > 0) this.stack.at(-1)!.element.children.push(element);
    else if (this.root) throw new XmlError('More than one root element');
    else this.root = element;
    if (selfClosing) return;
    if (this.stack.length >= MAX_DEPTH) throw new XmlError('Elements nested too deeply');
    this.stack.push({ element, text: [], qualified });
  }

  private attributes(element: XmlElement, qualified: string) {
    for (;;) {
      const space = /^\s*/.exec(this.source.slice(this.i, this.i + 64))![0].length;
      this.i += space;
      const rest = this.source.slice(this.i, this.i + 4096);
      if (rest.startsWith('/>') || rest.startsWith('>')) return;
      const attribute = space > 0 ? ATTRIBUTE.exec(rest) : null;
      if (!attribute) throw new XmlError(`Invalid attribute in <${qualified}>`);
      element.attributes[localName(attribute[1]!)] = decode(attribute[2] ?? attribute[3] ?? '');
      this.i += attribute[0].length;
    }
  }
}

export const parseXml = (source: string, { maxElements = MAX_ELEMENTS }: { maxElements?: number } = {}): XmlElement =>
  new Reader(source, maxElements).read();

/** The first child with this local name. */
export const child = (e: XmlElement | undefined, name: string) => e?.children.find((c) => c.name === name);
/** All children with this local name. */
export const childrenOf = (e: XmlElement | undefined, name: string) => e?.children.filter((c) => c.name === name) ?? [];
/** The element at this path of local names, each step the first child. */
export const at = (e: XmlElement | undefined, ...path: string[]) => path.reduce<XmlElement | undefined>((x, name) => child(x, name), e);
