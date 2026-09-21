import type { Chapter, ID, Project } from "@/core";
import { createZip, createZipWithStoredFirst, type ZipEntry } from "./zip";

/**
 * EPUB 3 与 DOCX（真 OOXML）生成器。
 * 两者都基于自己的 ZIP 写入器，不依赖任何第三方库 —— 桌面端可以直接复用。
 */

// ==================== 公共工具 ====================

const XML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESC[c] ?? c);
}

/** 把正文文本切成段落（中文换行即分段，去掉段首全角空格，缩进交给样式） */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n/)
    .map((p) => p.replace(/^[\u3000\s]+/, '').trim())
    .filter((p) => p.length > 0);
}

/** 生成稳定且合法的 XML ID（中文标题不能直接当 id） */
function xmlId(prefix: string, index: number): string {
  return prefix + '-' + (index + 1);
}

function isoDate(d = new Date()): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

export interface EbookChapter {
  chapter: Chapter;
  text: string;
}

export interface EbookOptions {
  project: Project;
  chapters: EbookChapter[];
  /** 卷名映射，用于插入卷标题页 */
  arcNames?: Record<ID, string>;
  /** 每章是否重新起页（EPUB 用 css page-break，DOCX 用分页符） */
  pageBreakPerChapter?: boolean;
  /** 目录里是否包含卷 */
  includeArcPages?: boolean;
  /** 封面图（可选，PNG/JPEG 字节 + mime） */
  cover?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; ext: string };
}

const BOOK_CSS = [
  'body { margin: 0 5%; line-height: 1.9; font-family: "Songti SC", "Source Han Serif SC", serif; }',
  'h1 { font-size: 1.4em; text-align: center; margin: 1.6em 0 1.2em; font-family: system-ui, sans-serif; }',
  'h2.arc { font-size: 1.2em; text-align: center; margin: 2.4em 0 1.6em; font-family: system-ui, sans-serif; }',
  'p { margin: 0 0 0.9em; text-indent: 2em; }',
  'p.summary { color: #666; font-style: italic; text-indent: 0; font-size: 0.92em; }',
  '.cover { text-align: center; margin: 0; padding: 0; }',
  '.cover img { max-width: 100%; max-height: 100%; }',
  '.chapter { page-break-before: always; }',
  'nav ol { list-style: none; padding-left: 0; }',
  'nav li { margin: 0.35em 0; }',
].join('\n');

// ==================== EPUB 3 ====================

export async function buildEpub(opts: EbookOptions): Promise<Blob> {
  const { project, chapters } = opts;
  const uid = 'urn:uuid:' + (project.id || 'huajiao') + '-' + Date.now();
  const pageBreak = opts.pageBreakPerChapter !== false;

  // 章节文档
  const chapterDocs: { id: string; href: string; title: string; html: string }[] = [];
  let arcCursor: ID | undefined;
  chapters.forEach((item, i) => {
    const id = xmlId('ch', i);
    const href = 'chapter-' + (i + 1) + '.xhtml';
    const body: string[] = [];
    const arcId = item.chapter.arcId;
    if (opts.includeArcPages !== false && arcId && arcId !== arcCursor && opts.arcNames?.[arcId]) {
      body.push('<h2 class="arc">' + escapeXml(opts.arcNames[arcId]) + '</h2>');
      arcCursor = arcId;
    }
    body.push('<h1>' + escapeXml(item.chapter.title) + '</h1>');
    if (item.chapter.summary) body.push('<p class="summary">' + escapeXml(item.chapter.summary) + '</p>');
    for (const p of toParagraphs(item.text)) body.push('<p>' + escapeXml(p) + '</p>');
    const html =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<!DOCTYPE html>' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' +
      (project.language || 'zh-CN') +
      '" xml:lang="' +
      (project.language || 'zh-CN') +
      '">' +
      '<head><meta charset="utf-8"/><title>' + escapeXml(item.chapter.title) + '</title>' +
      '<link rel="stylesheet" type="text/css" href="style.css"/></head>' +
      '<body' + (pageBreak ? ' class="chapter"' : '') + '>' +
      body.join('') +
      '</body></html>';
    chapterDocs.push({ id, href, title: item.chapter.title, html });
  });

  // 目录（EPUB 3 nav + NCX 兼容）
  const navItems = chapterDocs
    .map((c) => '<li><a href="' + c.href + '">' + escapeXml(c.title) + '</a></li>')
    .join('');
  const navDoc =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<!DOCTYPE html>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' +
    (project.language || 'zh-CN') +
    '">' +
    '<head><meta charset="utf-8"/><title>目录</title>' +
    '<link rel="stylesheet" type="text/css" href="style.css"/></head><body>' +
    '<nav epub:type="toc" id="toc"><h1>目录</h1><ol>' + navItems + '</ol></nav>' +
    '</body></html>';

  const ncx =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    '<head><meta name="dtb:uid" content="' + escapeXml(uid) + '"/></head>' +
    '<docTitle><text>' + escapeXml(project.title) + '</text></docTitle>' +
    '<navMap>' +
    chapterDocs
      .map(
        (c, i) =>
          '<navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' +
          escapeXml(c.title) +
          '</text></navLabel><content src="' + c.href + '"/></navPoint>',
      )
      .join('') +
    '</navMap></ncx>';

  const coverEntries: ZipEntry[] = [];
  let coverManifest = '';
  let coverSpine = '';
  let coverMeta = '';
  if (opts.cover) {
    const coverHref = 'cover.' + opts.cover.ext;
    coverEntries.push({ path: 'OEBPS/' + coverHref, bytes: opts.cover.bytes });
    coverManifest =
      '<item id="cover-image" href="' + coverHref + '" media-type="' + opts.cover.mime + '" properties="cover-image"/>';
    coverSpine = '<itemref idref="cover"/>';
    coverMeta = '<meta name="cover" content="cover-image"/>';
    chapterDocs.unshift({
      id: 'cover',
      href: 'cover.xhtml',
      title: '封面',
      html:
        '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>' +
        '<html xmlns="http://www.w3.org/1999/xhtml" lang="' + (project.language || 'zh-CN') + '">' +
        '<head><meta charset="utf-8"/><title>封面</title>' +
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>' +
        '<body><div class="cover"><img src="' + coverHref + '" alt="封面"/></div></body></html>',
    });
  }

  const opf =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' +
    (project.language || 'zh-CN') +
    '">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:identifier id="bookid">' + escapeXml(uid) + '</dc:identifier>' +
    '<dc:title>' + escapeXml(project.title) + '</dc:title>' +
    (project.author ? '<dc:creator>' + escapeXml(project.author) + '</dc:creator>' : '') +
    '<dc:language>' + (project.language || 'zh-CN') + '</dc:language>' +
    (project.logline ? '<dc:description>' + escapeXml(project.logline) + '</dc:description>' : '') +
    (project.genres.length ? '<dc:subject>' + escapeXml(project.genres.join(' / ')) + '</dc:subject>' : '') +
    '<meta property="dcterms:modified">' + isoDate() + '</meta>' +
    coverMeta +
    '</metadata>' +
    '<manifest>' +
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '<item id="css" href="style.css" media-type="text/css"/>' +
    coverManifest +
    chapterDocs
      .filter((c) => c.id !== 'cover')
      .map((c) => '<item id="' + c.id + '" href="' + c.href + '" media-type="application/xhtml+xml"/>')
      .join('') +
    '</manifest>' +
    '<spine toc="ncx">' +
    coverSpine +
    chapterDocs
      .filter((c) => c.id !== 'cover')
      .map((c) => '<itemref idref="' + c.id + '"/>')
      .join('') +
    '</spine></package>';

  const container =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>';

  const entries: ZipEntry[] = [
    { path: 'OEBPS/style.css', text: BOOK_CSS },
    { path: 'OEBPS/nav.xhtml', text: navDoc },
    { path: 'OEBPS/toc.ncx', text: ncx },
    { path: 'OEBPS/content.opf', text: opf },
    ...coverEntries,
    ...chapterDocs.map((c) => ({ path: 'OEBPS/' + c.href, text: c.html })),
    { path: 'META-INF/container.xml', text: container },
  ];

  // mimetype 必须是第一个条目且不压缩（EPUB 规范硬要求）
  return createZipWithStoredFirst({ path: 'mimetype', text: 'application/epub+zip' }, entries);
}

// ==================== DOCX (OOXML) ====================

function docxParagraph(text: string, style?: string): string {
  const pPr =
    '<w:pPr>' +
    '<w:ind w:firstLineChars="200"/>' +
    '<w:spacing w:line="360" w:lineRule="auto" w:after="120"/>' +
    (style ? '<w:pStyle w:val="' + style + '"/>' : '') +
    '</w:pPr>';
  return (
    '<w:p>' +
    pPr +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>'
  );
}

function docxTitle(text: string, level: 1 | 2): string {
  const size = level === 1 ? 36 : 30;
  const before = level === 1 ? 480 : 360;
  return (
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="' + before + '" w:after="240"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="黑体" w:hAnsi="Arial"/><w:b/><w:sz w:val="' + size + '"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>'
  );
}

export async function buildDocx(opts: EbookOptions): Promise<Blob> {
  const { project, chapters } = opts;
  const pageBreak = opts.pageBreakPerChapter !== false;
  const body: string[] = [];

  // 封面信息
  body.push(docxTitle(project.title, 1));
  if (project.author) {
    body.push(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="22"/></w:rPr>' +
        '<w:t xml:space="preserve">' + escapeXml(project.author) + '</w:t></w:r></w:p>',
    );
  }
  if (project.logline) {
    body.push(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:rFonts w:eastAsia="宋体"/><w:sz w:val="22"/></w:rPr>' +
        '<w:t xml:space="preserve">' + escapeXml(project.logline) + '</w:t></w:r></w:p>',
    );
  }

  let arcCursor: ID | undefined;
  chapters.forEach((item) => {
    const arcId = item.chapter.arcId;
    if (opts.includeArcPages !== false && arcId && arcId !== arcCursor && opts.arcNames?.[arcId]) {
      if (pageBreak) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      body.push(docxTitle(opts.arcNames[arcId], 1));
      arcCursor = arcId;
    }
    if (pageBreak) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    body.push(docxTitle(item.chapter.title, 2));
    if (item.chapter.summary) body.push(docxParagraph(item.chapter.summary, 'Quote'));
    for (const p of toParagraphs(item.text)) body.push(docxParagraph(p));
  });

  // 分节：A4 页面 + 页边距
  const sectPr =
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
    '<w:docGrid w:linePitch="312"/>' +
    '</w:sectPr>';

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>' +
    '<w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:styleId="Quote">' +
    '<w:name w:val="Quote"/><w:pPr><w:ind w:firstLineChars="0" w:left="420"/></w:pPr>' +
    '<w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="21"/></w:rPr></w:style>' +
    '</w:styles>';

  const coreXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escapeXml(project.title) + '</dc:title>' +
    (project.author ? '<dc:creator>' + escapeXml(project.author) + '</dc:creator>' : '') +
    '<cp:lastModifiedBy>花椒写作平台</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + isoDate() + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + isoDate() + '</dcterms:modified>' +
    '</cp:coreProperties>';

  const appXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>花椒写作平台</Application>' +
    '<Words>' + chapters.reduce((n, c) => n + c.chapter.wordCount, 0) + '</Words>' +
    '</Properties>';

  return createZip([
    { path: '[Content_Types].xml', text: contentTypes },
    { path: '_rels/.rels', text: rootRels },
    { path: 'docProps/core.xml', text: coreXml },
    { path: 'docProps/app.xml', text: appXml },
    { path: 'word/document.xml', text: documentXml },
    { path: 'word/styles.xml', text: styles },
    { path: 'word/_rels/document.xml.rels', text: docRels },
  ]);
}