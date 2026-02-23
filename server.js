require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { crawlWebsite } = require('./scraper');
const { exportXLSX, exportCSV } = require('./exporter');
const { initDB, saveResult, getXlsx, getCsv, deleteOldResults } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job store
const jobs = {};

// ─── API: Start Scrape ──────────────────────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const { url, maxPages, maxDepth } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Invalid URL. Must start with http:// or https://' });
  }

  const jobId = uuidv4();
  jobs[jobId] = {
    status: 'pending', url,
    maxPages: parseInt(maxPages) || 100,
    maxDepth: maxDepth !== undefined ? parseInt(maxDepth) : 2,
    stopRequested: false,
    createdAt: new Date().toISOString(),
  };

  res.json({ jobId });

  runScrapeJob(jobId, url).catch((err) => {
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
    io.to(jobId).emit('job:error', { jobId, error: err.message });
  });
});

// ─── API: Stop Scrape ───────────────────────────────────────────────────────
app.post('/api/stop/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running') return res.status(400).json({ error: 'Job is not running' });
  job.stopRequested = true;
  res.json({ ok: true });
});

async function runScrapeJob(jobId, url) {
  jobs[jobId].status = 'running';
  io.to(jobId).emit('job:status', { jobId, status: 'running', message: 'Starting scrape...' });

  const job = jobs[jobId];
  const data = await crawlWebsite(
    url,
    (progress) => {
      jobs[jobId].progress = progress;
      io.to(jobId).emit('job:progress', { jobId, ...progress });
    },
    {
      maxPages: job.maxPages,
      maxDepth: job.maxDepth,
      shouldStop: () => job.stopRequested,
    }
  );

  jobs[jobId].status = 'exporting';
  io.to(jobId).emit('job:progress', { jobId, stage: 'exporting', message: 'Saving to database...' });

  const [xlsxBuffer, csvString] = await Promise.all([
    exportXLSX(data),
    Promise.resolve(exportCSV(data)),
  ]);

  await saveResult(jobId, url, xlsxBuffer, csvString);

  jobs[jobId].status = 'done';
  jobs[jobId].data = data;

  io.to(jobId).emit('job:done', {
    jobId,
    meta: data.meta,
    summary: buildSummary(data),
    previewData: buildPreview(data),
    stoppedEarly: data.crawlStats?.stoppedEarly || false,
  });
}

function buildSummary(data) {
  return {
    listings:  data.listings.length,
    tables:    data.tables.length,
    links:     data.links.length,
    headings:  data.headings.length,
    paragraphs: data.paragraphs.length,
    images:    data.images.length,
    pagesVisited: data.crawlStats?.pagesVisited || 1,
    stoppedEarly: data.crawlStats?.stoppedEarly || false,
  };
}

function buildPreview(data) {
  return {
    meta: data.meta,
    listings: data.listings.slice(0, 200),
    tables: data.tables.slice(0, 3).map((t) => ({
      index: t.index,
      headers: t.headers,
      rows: t.rows.slice(0, 10),
      total: t.rows.length,
    })),
    headings: data.headings.slice(0, 30),
    paragraphs: data.paragraphs.slice(0, 10),
    links: data.links.slice(0, 100),
    images: data.images.slice(0, 20),
  };
}

// ─── API: Job Status ────────────────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, progress: job.progress, error: job.error });
});

// ─── API: Download (served from database) ───────────────────────────────────
app.get('/api/download/:jobId/:format', async (req, res) => {
  const { jobId, format } = req.params;
  const job = jobs[jobId];

  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(400).json({ error: 'Job not complete' });
  if (!['xlsx', 'csv'].includes(format)) return res.status(400).json({ error: 'Invalid format' });

  const hostname = new URL(job.url).hostname.replace(/\./g, '_');
  const filename = `${hostname}_scrape.${format}`;

  try {
    if (format === 'xlsx') {
      const data = await getXlsx(jobId);
      if (!data) return res.status(404).json({ error: 'File not found in database' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(data);
    } else {
      const data = await getCsv(jobId);
      if (!data) return res.status(404).json({ error: 'File not found in database' });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(data);
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ─── Socket.io ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join:job', (jobId) => {
    socket.join(jobId);

    const job = jobs[jobId];
    if (job?.status === 'done') {
      socket.emit('job:done', {
        jobId,
        meta: job.data.meta,
        summary: buildSummary(job.data),
        previewData: buildPreview(job.data),
        stoppedEarly: job.data.crawlStats?.stoppedEarly || false,
      });
    } else if (job?.status === 'error') {
      socket.emit('job:error', { jobId, error: job.error });
    }
  });
});

// ─── Cleanup old jobs (older than 1 hour) ──────────────────────────────────
setInterval(async () => {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  try {
    await deleteOldResults(cutoff);
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
  Object.entries(jobs).forEach(([id, job]) => {
    if (new Date(job.createdAt).getTime() < cutoff.getTime()) {
      delete jobs[id];
    }
  });
}, 15 * 60 * 1000);

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 6969;

initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🌐 Web Scraper running at http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to database:', err.message);
    console.error('Make sure DATABASE_URL is set correctly in your .env file');
    process.exit(1);
  });
