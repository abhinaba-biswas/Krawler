const ExcelJS = require('exceljs');

// Column definition matching sample format
const LISTING_COLS = [
  { header: 'name',       key: 'name',       width: 45 },
  { header: 'hall',       key: 'hall',        width: 35 },
  { header: 'stand',      key: 'stand',       width: 12 },
  { header: 'website',    key: 'website',     width: 50 },
  { header: 'facebook',   key: 'facebook',    width: 55 },
  { header: 'instagram',  key: 'instagram',   width: 55 },
  { header: 'youtube',    key: 'youtube',     width: 55 },
  { header: 'twitter',    key: 'twitter',     width: 55 },
  { header: 'linkedin',   key: 'linkedin',    width: 55 },
  { header: 'otherLinks', key: 'otherLinks',  width: 80 },
];

// ─── XLSX Export — returns a Buffer ──────────────────────────────────────────
async function exportXLSX(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Web Scraper';
  workbook.created = new Date();

  // ── Sheet 1: Listings ──────────────────────────────────────────────────────
  const listingSheet = workbook.addWorksheet('Listings');
  listingSheet.columns = LISTING_COLS;
  styleHeader(listingSheet, 'FF16A34A');

  if (data.listings.length > 0) {
    data.listings.forEach((row) => listingSheet.addRow(row));
  } else {
    listingSheet.addRow({ name: 'No structured listings detected on this page.' });
  }

  // ── Sheet 2: All Links ────────────────────────────────────────────────────
  if (data.links.length > 0) {
    const sheet = workbook.addWorksheet('All Links');
    sheet.columns = [
      { header: 'Text', key: 'text', width: 40 },
      { header: 'URL',  key: 'url',  width: 100 },
    ];
    styleHeader(sheet);
    data.links.forEach((l) => sheet.addRow(l));
  }

  // ── Sheet 3: Tables ───────────────────────────────────────────────────────
  data.tables.forEach((table, idx) => {
    const sheet = workbook.addWorksheet(`Table ${idx + 1}`);
    if (table.headers.length > 0) {
      sheet.columns = table.headers.map((h, i) => ({
        header: h || `Col ${i + 1}`,
        key: `col${i}`,
        width: Math.max(15, (h || '').length + 5),
      }));
      styleHeader(sheet);
      table.rows.forEach((row) => {
        const rowObj = {};
        table.headers.forEach((_, i) => { rowObj[`col${i}`] = row[i] || ''; });
        sheet.addRow(rowObj);
      });
    } else {
      table.rows.forEach((row) => sheet.addRow(row));
    }
  });

  // ── Sheet 4: Headings ─────────────────────────────────────────────────────
  if (data.headings.length > 0) {
    const sheet = workbook.addWorksheet('Headings');
    sheet.columns = [
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Text',  key: 'text',  width: 100 },
    ];
    styleHeader(sheet);
    data.headings.forEach((h) => sheet.addRow(h));
  }

  // ── Sheet 5: Paragraphs ───────────────────────────────────────────────────
  if (data.paragraphs.length > 0) {
    const sheet = workbook.addWorksheet('Paragraphs');
    sheet.columns = [
      { header: '#',    key: 'index', width: 6 },
      { header: 'Text', key: 'text',  width: 150 },
    ];
    styleHeader(sheet);
    data.paragraphs.forEach((p, i) => sheet.addRow({ index: i + 1, text: p.text }));
  }

  // ── Sheet 6: Images ───────────────────────────────────────────────────────
  if (data.images.length > 0) {
    const sheet = workbook.addWorksheet('Images');
    sheet.columns = [
      { header: 'Alt Text',   key: 'alt', width: 40 },
      { header: 'Source URL', key: 'src', width: 120 },
    ];
    styleHeader(sheet);
    data.images.forEach((img) => sheet.addRow(img));
  }

  // ── Sheet 7: Meta ─────────────────────────────────────────────────────────
  const metaSheet = workbook.addWorksheet('Meta');
  metaSheet.columns = [
    { header: 'Field', key: 'field', width: 20 },
    { header: 'Value', key: 'value', width: 80 },
  ];
  styleHeader(metaSheet);
  Object.entries(data.meta).forEach(([k, v]) => metaSheet.addRow({ field: k, value: v }));

  return workbook.xlsx.writeBuffer();
}

// ─── CSV Export — returns a string ───────────────────────────────────────────
function exportCSV(data) {
  const sections = [];

  sections.push('=== LISTINGS ===');
  sections.push(csvRow(['name', 'hall', 'stand', 'website', 'facebook', 'instagram', 'youtube', 'twitter', 'linkedin', 'otherLinks']));
  if (data.listings.length > 0) {
    data.listings.forEach((l) =>
      sections.push(csvRow([l.name, l.hall, l.stand, l.website, l.facebook, l.instagram, l.youtube, l.twitter, l.linkedin, l.otherLinks]))
    );
  } else {
    sections.push(csvRow(['No structured listings detected on this page.', '', '', '', '', '', '', '', '', '']));
  }
  sections.push('');

  if (data.links.length > 0) {
    sections.push('=== ALL LINKS ===');
    sections.push(csvRow(['Text', 'URL']));
    data.links.forEach((l) => sections.push(csvRow([l.text, l.url])));
    sections.push('');
  }

  data.tables.forEach((table, idx) => {
    sections.push(`=== TABLE ${idx + 1} ===`);
    if (table.headers.length > 0) sections.push(csvRow(table.headers));
    table.rows.forEach((row) => sections.push(csvRow(row)));
    sections.push('');
  });

  if (data.headings.length > 0) {
    sections.push('=== HEADINGS ===');
    sections.push(csvRow(['Level', 'Text']));
    data.headings.forEach((h) => sections.push(csvRow([h.level, h.text])));
    sections.push('');
  }

  if (data.paragraphs.length > 0) {
    sections.push('=== PARAGRAPHS ===');
    sections.push(csvRow(['#', 'Text']));
    data.paragraphs.forEach((p, i) => sections.push(csvRow([i + 1, p.text])));
    sections.push('');
  }

  sections.push('=== META ===');
  sections.push(csvRow(['Field', 'Value']));
  Object.entries(data.meta).forEach(([k, v]) => sections.push(csvRow([k, v])));

  return sections.join('\n');
}

function csvRow(cells) {
  return cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

function styleHeader(sheet, color = 'FF2563EB') {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 20;
}

module.exports = { exportXLSX, exportCSV };
