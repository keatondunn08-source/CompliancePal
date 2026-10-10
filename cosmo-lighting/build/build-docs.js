// Builds the Cosmo Lighting Kensington agreement and invoice (.docx) from config.json.
// Run from the repo root:  NODE_PATH=$(npm root -g) node cosmo-lighting/build/build-docs.js
// Placeholders written as [IN CAPS] are highlighted yellow so none slip through to the client.

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, BorderStyle, Header, Footer, PageNumber, LevelFormat, TabStopType,
  VerticalAlign, HeadingLevel, LineRuleType,
} = require('docx');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const OUT = path.resolve(__dirname, '..');

// ---------- formatting ----------

const C = {
  ink: '1F2A37', accent: '9A6A12', muted: '5F6670', line: 'D8D2C4',
  fill: 'F5F1E8', fillAccent: 'FBF3E1', white: 'FFFFFF',
};
const FONT = 'Arial';
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9638

const money = (n) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseDate = (iso) => new Date(iso + 'T00:00:00');
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const fmtDate = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

const P = cfg.provider, CL = cfg.client, AG = cfg.agreement, INV = cfg.invoice, CARE = cfg.carePlan;
const total = cfg.lineItems.reduce((s, i) => s + i.fee, 0);
const gstRegistered = P.gst !== 'none';
const gstAmount = P.gst === 'exclusive' ? total * 0.1 : P.gst === 'inclusive' ? total / 11 : 0;
const grandTotal = P.gst === 'exclusive' ? total + gstAmount : total;
const deposit = grandTotal * INV.depositPercent / 100;
const balance = grandTotal - deposit;
const gstNote = {
  none: `No GST is charged. ${P.businessName} is not registered for GST.`,
  inclusive: `All prices include GST.`,
  exclusive: `All prices exclude GST. GST of 10% is added on the invoice.`,
}[P.gst];

function runs(text, o = {}) {
  return String(text).split(/(\[[A-Z][^\]]*\])/).filter((s) => s !== '').map((s) => new TextRun({
    text: s, font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics,
    color: o.color || C.ink, characterSpacing: o.spacing,
    highlight: /^\[[A-Z]/.test(s) ? 'yellow' : undefined,
  }));
}

// segs: string | Array<string | {t, bold, color, italics, size}>
function rich(segs, base = {}) {
  const list = Array.isArray(segs) ? segs : [segs];
  return list.flatMap((s) => (typeof s === 'string' ? runs(s, base) : runs(s.t, { ...base, ...s })));
}

function para(segs, o = {}) {
  return new Paragraph({
    children: rich(segs, o),
    alignment: o.align,
    keepNext: o.keepNext,
    keepLines: o.keepLines,
    numbering: o.bullet ? { reference: 'bullets', level: o.level || 0 } : undefined,
    spacing: { before: o.before ?? 0, after: o.after ?? 100, line: o.line ?? 276, lineRule: LineRuleType.AUTO },
    border: o.border,
    tabStops: o.tabStops,
  });
}

const bullet = (segs, o = {}) => para(segs, { after: 60, ...o, bullet: true });

function heading(num, text, o = {}) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: o.pageBreakBefore,
    keepNext: true, keepLines: true,
    spacing: { before: 260, after: 110 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line, space: 4 } },
    children: [
      new TextRun({ text: `${num}   `, font: FONT, size: 22, bold: true, color: C.accent }),
      new TextRun({ text, font: FONT, size: 22, bold: true, color: C.ink }),
    ],
  });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: C.line };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const TABLE_NO_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

function cell(children, o = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: o.width, type: WidthType.DXA },
    columnSpan: o.span,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders: { ...NO_BORDERS, ...(o.borders || {}) },
    margins: o.margins || { top: 110, bottom: 110, left: 150, right: 150 },
    verticalAlign: o.vAlign,
  });
}

function table(widths, rows, o = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: o.borders || TABLE_NO_BORDERS,
    rows,
  });
}

const label = (text, o = {}) => para(text, { size: 15, bold: true, color: C.accent, spacing: 20, after: 60, ...o });
const spacer = (after = 120) => new Paragraph({ spacing: { before: 0, after }, children: [] });

const numbering = {
  config: [{
    reference: 'bullets',
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 400, hanging: 260 } }, run: { color: C.accent } },
    }, {
      level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 800, hanging: 260 } }, run: { color: C.accent } },
    }],
  }],
};

const styles = {
  default: { document: { run: { font: FONT, size: 20, color: C.ink } } },
  paragraphStyles: [{
    id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font: FONT, size: 22, bold: true, color: C.ink },
    paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 0 },
  }, {
    id: 'FooterText', name: 'Footer Text', basedOn: 'Normal',
    run: { font: FONT, size: 15, color: C.muted },
  }],
};

const pageProps = {
  page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 560, footer: 560 } },
};

function footer(leftText) {
  return new Footer({
    children: [new Paragraph({
      style: 'FooterText',
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        ...runs(leftText, { size: 15, color: C.muted }),
        new TextRun({ font: FONT, size: 15, color: C.muted, children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] }),
      ],
    })],
  });
}

// ---------- agreement ----------

function buildAgreement() {
  const agDate = parseDate(AG.date);
  const validUntil = addDays(agDate, AG.offerValidDays);
  const half = CONTENT_W / 2;

  const partyCol = (title, lines) => cell([
    label(title),
    ...lines.map((l, i) => para(l, { after: 30, bold: i === 0, size: i === 0 ? 21 : 19, color: i === 0 ? C.ink : C.muted })),
  ], { width: half, fill: C.fill, margins: { top: 160, bottom: 160, left: 200, right: 200 } });

  const parties = table([half, half], [new TableRow({ children: [
    partyCol('PROVIDER  —  “WE”, “US”', [
      P.businessName, P.contactName, `ABN ${P.abn}`, P.email, P.phone,
    ]),
    partyCol('CLIENT  —  “YOU”', [
      CL.legalName, `trading as ${CL.tradingName}`, `ABN ${CL.abn}`,
      `Attention: ${CL.contactName}`, `${CL.email}  ·  ${CL.phone}`, CL.address.join(', '),
    ]),
  ] })], { borders: { ...TABLE_NO_BORDERS, insideVertical: { style: BorderStyle.SINGLE, size: 24, color: C.white } } });

  // Scope table
  const W = [2500, 5538, 1600];
  const scopeDetail = {
    'Signature Website Package': 'Your new website, designed and built for Cosmo Lighting Kensington. Includes your full lighting and spare-parts range, your existing Shopify checkout and payment methods, a mobile-friendly and search-friendly build, website hosting (see section 4) and launch support.',
    'Supplier Sync Agent': `An automated agent that watches ${cfg.suppliers.join(' and ')} and keeps your website up to date: live prices, new and discontinued products, and in-stock / out-of-stock status. Your pricing rules include supplier freight costs, so freight increases flow into your prices instead of coming out of your margin.`,
    'Postcode Shipping Calculator': 'Customers enter their postcode and see an Australia Post delivery cost before they pay, so freight is never under-charged at checkout.',
    'Google Business Profile Optimisation': 'A full review and update of your Google Business Profile: categories, hours, description, products, photos and a simple way to ask customers for reviews.',
  };
  const headCell = (t, w, align) => cell(para(t, { size: 16, bold: true, color: C.white, after: 0, spacing: 20, align }), { width: w, fill: C.ink });
  const rowBorder = { bottom: LINE };
  const scopeRows = [
    new TableRow({ tableHeader: true, children: [headCell('ITEM', W[0]), headCell('WHAT YOU GET', W[1]), headCell('FEE', W[2], AlignmentType.RIGHT)] }),
    ...cfg.lineItems.map((item, i) => {
      const keepNext = i === cfg.lineItems.length - 1;
      const m = { top: 90, bottom: 90, left: 150, right: 150 };
      return new TableRow({ cantSplit: true, children: [
        cell(para(item.name, { bold: true, after: 0, keepNext }), { width: W[0], borders: rowBorder, margins: m }),
        cell(para(scopeDetail[item.name] || item.invoiceDetail, { size: 19, after: 0, keepNext }), { width: W[1], borders: rowBorder, margins: m }),
        cell(para(item.fee ? money(item.fee) : 'Included', { bold: true, after: 0, keepNext, align: AlignmentType.RIGHT }), { width: W[2], borders: rowBorder, margins: m }),
      ] });
    }),
    new TableRow({ cantSplit: true, children: [
      cell(para(P.gst === 'exclusive' ? 'Total project fee (excl. GST)' : 'Total project fee', { bold: true, after: 0 }), { width: W[0] + W[1], span: 2, fill: C.fill }),
      cell(para(money(total), { bold: true, size: 22, after: 0, align: AlignmentType.RIGHT }), { width: W[2], fill: C.fill }),
    ] }),
  ];

  // Care Plan callout
  const careBox = table([120, CONTENT_W - 120], [new TableRow({ cantSplit: true, children: [
    cell(para(''), { width: 120, fill: C.accent, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    cell([
      label('COMPLETELY OPTIONAL  —  YOU DO NOT NEED THIS', { after: 80 }),
      para('Your website, hosting and Supplier Sync Agent all work without the Care Plan. It’s simply there if you’d rather we look after small updates for you.', { after: 120 }),
      para([{ t: `${money(CARE.monthly).replace('.00', '')} per month`, bold: true, size: 24 }, { t: '   or   ', color: C.muted, size: 20 }, { t: `${money(CARE.annual).replace('.00', '')} per year`, bold: true, size: 24 }, { t: '   (two months free)', color: C.muted, size: 19 }], { after: 140 }),
      para('What it covers', { bold: true, after: 40 }),
      bullet('updating product and store photos;'),
      bullet('adding new customer reviews to your website; and'),
      bullet('small text and content updates — opening hours, contact details, promotions and banners.', { after: 120 }),
      para('What it does not cover', { bold: true, after: 40 }),
      bullet([{ t: 'Hosting. ', bold: true }, 'Hosting is already included in your Signature Website Package. The Care Plan is not a hosting fee.']),
      bullet('New pages, new features or redesign work (quoted separately).', { after: 120 }),
      para('Join, change or cancel any time with 30 days’ written notice. Annual plans are paid upfront, aren’t refunded part-way through the year, and only renew if you ask us to. Tick your choice in section 10 — choosing “No thanks” changes nothing else in this agreement.', { size: 18, color: C.muted, after: 0 }),
    ], { width: CONTENT_W - 120, fill: C.fillAccent, margins: { top: 200, bottom: 200, left: 260, right: 260 } }),
  ] })]);

  // Signature block
  const sigLine = (labelText, value) => [
    para(labelText, { size: 16, color: C.muted, after: 20 }),
    para(value || ' ', { after: 160, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.ink, space: 2 } } }),
  ];
  const sigCol = (title, entity, name, withPosition) => cell([
    para(title, { bold: true, after: 20 }),
    para(entity, { size: 18, color: C.muted, after: 200 }),
    ...sigLine('Signature'),
    ...sigLine('Name', name),
    ...(withPosition ? sigLine('Position') : []),
    ...sigLine('Date'),
  ], { width: half, margins: { top: 0, bottom: 0, left: 0, right: 300 } });

  const tick = (text, sub) => para([
    { t: '☐', size: 26, color: C.accent }, { t: '   ' }, { t: text, bold: true }, ...(sub ? [{ t: `   ${sub}`, color: C.muted, size: 18 }] : []),
  ], { after: 80, keepNext: true });

  const children = [
    para('WEBSITE SERVICES AGREEMENT', { size: 16, bold: true, color: C.accent, spacing: 40, after: 60 }),
    para('Signature Website Package', { size: 44, bold: true, before: 40, after: 60 }),
    para(`Prepared for ${CL.tradingName}  ·  ${fmtDate(agDate)}  ·  Ref ${AG.reference}`, { size: 19, color: C.muted, after: 220 }),
    parties,
    spacer(120),
    para('This agreement sets out what we’ll deliver, what it costs and how we’ll work together. It’s written in plain English on purpose. If anything is unclear, ask us before you sign.', { color: C.muted }),

    heading('1', 'The project'),
    para(`${CL.tradingName} is a family-owned lighting and spare-parts retailer on Anzac Parade, Kensington. Your online range mirrors what your suppliers carry and what’s on the shelves in store, and your main suppliers are ${cfg.suppliers.join(' and ')}. We’re rebuilding your website so that it:`),
    bullet('reflects the trust and reputation the business has built over decades of trading;'),
    bullet('keeps prices, products and stock levels in step with your suppliers automatically;'),
    bullet('shows customers an accurate delivery cost for their postcode before they pay; and'),
    bullet('keeps your existing Shopify checkout and payment methods exactly as they are.'),

    heading('2', 'What’s included'),
    table(W, scopeRows),
    spacer(80),
    para(gstNote, { size: 18, color: C.muted, after: 60 }),
    para('Not included: the optional Care Plan (section 3), third-party subscriptions (section 4) and any work outside this table, which we’ll quote in writing before starting.', { size: 18, color: C.muted }),

    heading('3', 'Optional Care Plan'),
    careBox,

    heading('4', 'Hosting'),
    bullet(`Hosting of your website is included in the Signature Website Package for the first ${AG.hostingIncludedMonths} months after launch. At least 30 days before that period ends, we’ll confirm in writing whether any hosting fee applies from then on. You’re free to move your website to another provider at any time.`),
    bullet('Hosting doesn’t include third-party services, which you keep paying for directly:', { after: 40 }),
    bullet('your Shopify plan and any paid Shopify apps;', { level: 1, after: 40 }),
    bullet('your domain name renewal and email accounts;', { level: 1, after: 40 }),
    bullet('your Australia Post account and postage; and', { level: 1, after: 40 }),
    bullet('Shopify’s carrier-calculated shipping feature, which the Postcode Shipping Calculator needs. Depending on your Shopify plan this may be included or cost extra each month. We’ll confirm which before launch, and nothing extra is added without your approval.', { level: 1 }),

    heading('5', 'Payment'),
    bullet([{ t: 'Deposit: ', bold: true }, `${INV.depositPercent}% (${money(deposit)}) to start work, due within ${INV.depositDueDays} days of signing.`]),
    bullet([{ t: 'Balance: ', bold: true }, `${100 - INV.depositPercent}% (${money(balance)}) due on completion, before the new website goes live on your domain.`]),
    bullet('Payment is by bank transfer to the account shown on the invoice.'),
    bullet('If you choose the Care Plan, it’s invoiced separately.'),
    bullet('If a payment is more than 14 days overdue, we may pause work until it’s paid.'),

    heading('6', 'What we need from you'),
    bullet('Staff access to your Shopify admin, your domain settings and your Google Business Profile.'),
    bullet(`Logins or data feeds for ${cfg.suppliers.join(' and ')}, and your confirmation that each supplier allows its price and stock data to be used this way.`),
    bullet('Your pricing rules: markup by supplier or category, how freight should be added, and how prices are rounded (for example, ending in .95).'),
    bullet('Weights and box sizes for the products you ship. Australia Post prices depend on them.'),
    bullet('Your Australia Post business account details (MyPost Business or eParcel), if you have one.'),
    bullet('Feedback and approvals within 5 business days, so the project keeps moving.'),

    heading('7', 'Supplier data, pricing and delivery'),
    bullet([{ t: 'Supplier data. ', bold: true }, 'The Supplier Sync Agent can only be as accurate as the data your suppliers publish. If a supplier’s data is wrong or late, your website may be too.']),
    bullet([{ t: 'Safety limit. ', bold: true }, 'Any price change bigger than an agreed limit (we suggest 20%) is held for your approval instead of going live automatically.']),
    bullet([{ t: 'Your prices. ', bold: true }, 'You set the pricing rules and remain responsible for the prices and stock shown on your website.']),
    bullet([{ t: 'Supplier changes. ', bold: true }, 'If a supplier changes its website, data feed or terms in a way that stops the agent working, we’ll let you know and quote the fix before doing any work.']),
    bullet([{ t: 'Australia Post limits. ', bold: true }, 'Australia Post won’t carry parcels over 22 kg or longer than 105 cm. Larger items, such as long battens, large pendants and ceiling fans, will show a delivery option you choose: flat-rate freight, “we’ll contact you with a quote”, or in-store pickup.']),

    heading('8', 'Timeline, changes and support'),
    bullet('We’ll agree a launch date once the deposit is paid and we have the access listed in section 6.'),
    bullet('Reasonable revisions during the build are included. Anything outside section 2 will be quoted in writing before we start.'),
    bullet('For 30 days after launch, we’ll fix any bugs in the work we delivered at no charge.'),

    heading('9', 'General terms'),
    bullet([{ t: 'Ownership. ', bold: true }, 'Once you’ve paid in full, you own your website’s design, content and data. We keep ownership of our own tools, code and know-how (including the agent software) and give you an ongoing licence to use them as part of your website.']),
    bullet([{ t: 'Portfolio. ', bold: true }, 'We may show your website in our portfolio unless you ask us not to.']),
    bullet([{ t: 'Google. ', bold: true }, 'We can’t guarantee search rankings, map positions or review numbers. Google controls those.']),
    bullet([{ t: 'Third parties. ', bold: true }, 'We’re not responsible for outages or changes made by Shopify, Australia Post, Google or your suppliers.']),
    bullet([{ t: 'Liability. ', bold: true }, 'To the extent the law allows, our total liability under this agreement is limited to the fees you’ve paid us. Nothing in this agreement limits your rights under the Australian Consumer Law.']),
    bullet([{ t: 'Confidentiality. ', bold: true }, 'We keep your logins, supplier pricing and business information confidential and use them only for this project.']),
    bullet([{ t: 'Ending the agreement. ', bold: true }, 'Either of us can end this agreement by written notice. You pay for work completed up to that date, and the deposit covers work already started.']),
    bullet([{ t: 'Law. ', bold: true }, `This agreement is governed by the laws of ${AG.governingState}.`]),

    heading('10', 'Acceptance', { pageBreakBefore: true }),
    para(`This offer is valid until ${fmtDate(validUntil)}. By signing, you accept this agreement and the fees in section 2.`, { after: 160, keepNext: true }),
    para('Optional Care Plan — tick one', { bold: true, after: 100, keepNext: true }),
    tick('No thanks, not right now', 'You can join any time.'),
    tick(`Monthly — ${money(CARE.monthly).replace('.00', '')} per month`),
    tick(`Annual — ${money(CARE.annual).replace('.00', '')} per year`, 'Two months free.'),
    spacer(240),
    table([half, half], [new TableRow({ cantSplit: true, children: [
      sigCol('For the Client', CL.legalName, CL.contactName, true),
      sigCol('For the Provider', P.businessName, P.contactName, false),
    ] })]),
  ];

  return new Document({
    creator: P.contactName,
    title: `Website Services Agreement — ${CL.tradingName}`,
    styles, numbering,
    sections: [{
      properties: pageProps,
      footers: { default: footer(`Website Services Agreement  ·  ${CL.tradingName}  ·  Ref ${AG.reference}`) },
      children,
    }],
  });
}

// ---------- invoice ----------

function buildInvoice() {
  const issue = parseDate(INV.date);
  const due = addDays(issue, INV.depositDueDays);
  const title = gstRegistered ? 'TAX INVOICE' : 'INVOICE';

  const metaRow = (k, v) => new TableRow({ children: [
    cell(para(k, { size: 17, color: C.muted, after: 0, align: AlignmentType.RIGHT }), { width: 1700, margins: { top: 30, bottom: 30, left: 0, right: 120 } }),
    cell(para(v, { size: 17, bold: true, after: 0, align: AlignmentType.RIGHT }), { width: 2100, margins: { top: 30, bottom: 30, left: 0, right: 0 } }),
  ] });

  const top = table([5838, 3800], [new TableRow({ children: [
    cell([
      para(P.businessName, { size: 30, bold: true, after: 60 }),
      para(P.contactName, { size: 18, color: C.muted, after: 20 }),
      para(`ABN ${P.abn}`, { size: 18, color: C.muted, after: 20 }),
      para(`${P.email}  ·  ${P.phone}`, { size: 18, color: C.muted, after: 0 }),
    ], { width: 5838, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    cell([
      para(title, { size: 40, bold: true, color: C.accent, after: 120, align: AlignmentType.RIGHT, spacing: 30 }),
      table([1700, 2100], [
        metaRow('Invoice no.', INV.number),
        metaRow('Issue date', fmtDate(issue)),
        metaRow('Deposit due', fmtDate(due)),
        metaRow('Agreement ref', AG.reference),
      ]),
    ], { width: 3800, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
  ] })]);

  const billTo = table([CONTENT_W], [new TableRow({ children: [cell([
    label('BILL TO'),
    para(CL.legalName, { bold: true, after: 30 }),
    para(`trading as ${CL.tradingName}  ·  ABN ${CL.abn}`, { size: 18, color: C.muted, after: 30 }),
    para(`Attention: ${CL.contactName}  ·  ${CL.email}`, { size: 18, color: C.muted, after: 30 }),
    para(CL.address.join(', '), { size: 18, color: C.muted, after: 0 }),
  ], { width: CONTENT_W, fill: C.fill, margins: { top: 160, bottom: 160, left: 200, right: 200 } })] })]);

  const W = [CONTENT_W - 1800, 1800];
  const rowBorder = { bottom: LINE };
  const items = table(W, [
    new TableRow({ tableHeader: true, children: [
      cell(para('DESCRIPTION', { size: 16, bold: true, color: C.white, after: 0, spacing: 20 }), { width: W[0], fill: C.ink }),
      cell(para('AMOUNT', { size: 16, bold: true, color: C.white, after: 0, spacing: 20, align: AlignmentType.RIGHT }), { width: W[1], fill: C.ink }),
    ] }),
    ...cfg.lineItems.map((item) => new TableRow({ cantSplit: true, children: [
      cell([
        para(item.name, { bold: true, after: 20 }),
        para(item.invoiceDetail, { size: 17, color: C.muted, after: 0, line: 252 }),
      ], { width: W[0], borders: rowBorder, margins: { top: 80, bottom: 80, left: 150, right: 150 } }),
      cell(para(item.fee ? money(item.fee) : 'Included', { bold: true, after: 0, align: AlignmentType.RIGHT }), { width: W[1], borders: rowBorder, vAlign: VerticalAlign.CENTER, margins: { top: 80, bottom: 80, left: 150, right: 150 } }),
    ] })),
  ]);

  const TW = [CONTENT_W - 4200, 2400, 1800];
  const totalRow = (k, v, o = {}) => new TableRow({ children: [
    cell(para('', { after: 0, size: 2 }), { width: TW[0], margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    cell(para(k, { size: o.size || 19, bold: o.bold, color: o.bold ? C.ink : C.muted, after: 0 }), { width: TW[1], borders: o.top ? { top: { style: BorderStyle.SINGLE, size: 8, color: C.ink } } : undefined, margins: { top: 60, bottom: 60, left: 150, right: 150 } }),
    cell(para(v, { size: o.size || 19, bold: o.bold, after: 0, align: AlignmentType.RIGHT }), { width: TW[2], borders: o.top ? { top: { style: BorderStyle.SINGLE, size: 8, color: C.ink } } : undefined, margins: { top: 60, bottom: 60, left: 150, right: 150 } }),
  ] });
  const totals = table(TW, [
    totalRow('Subtotal', money(total)),
    totalRow(P.gst === 'none' ? 'GST' : P.gst === 'inclusive' ? 'Includes GST of' : 'GST (10%)', P.gst === 'none' ? 'Not applicable' : money(gstAmount)),
    totalRow('Total project fee', money(grandTotal), { bold: true, size: 22, top: true }),
  ]);

  const SW = [3638, 3600, 2400];
  const schedHead = (t, w, align) => cell(para(t, { size: 16, bold: true, color: C.muted, after: 0, spacing: 20, align }), { width: w, borders: { bottom: LINE } });
  const schedule = table(SW, [
    new TableRow({ children: [schedHead('PAYMENT SCHEDULE', SW[0]), schedHead('DUE', SW[1]), schedHead('AMOUNT', SW[2], AlignmentType.RIGHT)] }),
    new TableRow({ children: [
      cell(para([{ t: `Deposit (${INV.depositPercent}%)`, bold: true }, { t: '   due now', color: C.accent, bold: true, size: 17 }], { after: 0 }), { width: SW[0], fill: C.fillAccent }),
      cell(para(fmtDate(due), { after: 0 }), { width: SW[1], fill: C.fillAccent }),
      cell(para(money(deposit), { bold: true, after: 0, align: AlignmentType.RIGHT }), { width: SW[2], fill: C.fillAccent }),
    ] }),
    new TableRow({ children: [
      cell(para(`Balance (${100 - INV.depositPercent}%)`, { after: 0 }), { width: SW[0], borders: { bottom: LINE } }),
      cell(para('On completion, before go-live', { after: 0 }), { width: SW[1], borders: { bottom: LINE } }),
      cell(para(money(balance), { after: 0, align: AlignmentType.RIGHT }), { width: SW[2], borders: { bottom: LINE } }),
    ] }),
  ]);

  const PW = [4819, 4819];
  const payLine = (k, v) => para([{ t: `${k}  `, color: C.muted, size: 18 }, { t: v, bold: true, size: 19 }], { after: 30 });
  const payBox = table(PW, [new TableRow({ children: [
    cell([
      label('AMOUNT DUE NOW'),
      para(`${money(deposit)} AUD`, { size: 40, bold: true, after: 40 }),
      para(`by ${fmtDate(due)}`, { size: 19, color: C.muted, after: 0 }),
    ], { width: PW[0], fill: C.fillAccent, margins: { top: 180, bottom: 180, left: 240, right: 240 } }),
    cell([
      label('PAY BY BANK TRANSFER'),
      payLine('Account name', P.bank.accountName),
      payLine('BSB', P.bank.bsb),
      payLine('Account no.', P.bank.accountNumber),
      payLine('Reference', INV.number),
    ], { width: PW[1], fill: C.fill, margins: { top: 180, bottom: 180, left: 240, right: 240 } }),
  ] })], { borders: { ...TABLE_NO_BORDERS, insideVertical: { style: BorderStyle.SINGLE, size: 24, color: C.white } } });

  const children = [
    top,
    spacer(200),
    billTo,
    spacer(200),
    items,
    spacer(40),
    totals,
    spacer(160),
    schedule,
    spacer(200),
    payBox,
    spacer(160),
    para([{ t: 'Optional Care Plan: ', bold: true }, `not part of this invoice. The ${money(CARE.monthly).replace('.00', '')}/month or ${money(CARE.annual).replace('.00', '')}/year Care Plan is entirely optional and does not include hosting, which is already included in your Signature Website Package. See section 3 of your agreement.`], { size: 17, color: C.muted, after: 60 }),
    para(`${gstNote}  Thank you for choosing ${P.businessName}.`, { size: 17, color: C.muted, after: 0 }),
  ];

  return new Document({
    creator: P.contactName,
    title: `${title} ${INV.number} — ${CL.tradingName}`,
    styles, numbering,
    sections: [{
      properties: pageProps,
      footers: { default: footer(`${title}  ·  ${INV.number}  ·  ${CL.tradingName}`) },
      children,
    }],
  });
}

(async () => {
  const outputs = [
    [buildAgreement(), 'Cosmo-Lighting-Website-Agreement.docx'],
    [buildInvoice(), `Cosmo-Lighting-Invoice-${INV.number}.docx`],
  ];
  for (const [doc, name] of outputs) {
    fs.writeFileSync(path.join(OUT, name), await Packer.toBuffer(doc));
    console.log('wrote', name);
  }
  console.log(`total ${money(grandTotal)} · deposit ${money(deposit)} · balance ${money(balance)} · gst=${P.gst}`);
})();
