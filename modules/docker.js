'use strict';

const { exec, spawn } = require('child_process');

const { sseHeaders } = require('./utils');

/** GET /api/docker/containers */
function handleContainers(req, res) {
  exec(`docker ps -a --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ containers });
  });
}

/** POST /api/docker/containers/:id/action */
function handleContainerAction(req, res) {
  const { action } = req.body;
  const id = req.params.id;
  const allowed = ['start', 'stop', 'restart', 'remove', 'rm'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const cmd = action === 'remove' ? `docker rm -f ${id}` : `docker ${action} ${id}`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, output: stdout.trim() });
  });
}

/** GET /api/docker/containers/:id/logs — SSE stream */
function handleContainerLogs(req, res) {
  sseHeaders(res);
  const id    = req.params.id;
  const tail  = req.query.tail || '200';
  const child = spawn('docker', ['logs', '-f', '--tail', tail, id]);

  const send = d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`);
  child.stdout.on('data', send);
  child.stderr.on('data', send);
  child.on('close', () => res.end());
  child.on('error', err => { res.write(`data: ${JSON.stringify(`[error: ${err.message}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** GET /api/docker/images */
function handleImages(req, res) {
  exec(`docker images --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const images = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ images });
  });
}

/** POST /api/docker/images/pull — SSE progress */
function handleImagePull(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'No image name' });
  sseHeaders(res);
  const child = spawn('docker', ['pull', name]);
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('error', err => { res.write(`data: ${JSON.stringify(`[error: ${err.message}]`)}\n\n`); res.end(); });
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** DELETE /api/docker/images/:id */
function handleImageDelete(req, res) {
  const id = decodeURIComponent(req.params.id);
  exec(`docker rmi ${id}`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
}

module.exports = {
  handleContainers,
  handleContainerAction,
  handleContainerLogs,
  handleImages,
  handleImagePull,
  handleImageDelete,
};
