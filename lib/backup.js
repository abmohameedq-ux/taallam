'use strict';
// Daily backup of the platform's JSON data (accounts, schools, fees, results, books' text...).
// Sessions and temporary files are left out. The last KEEP daily copies are retained under
// DATA_DIR/backups. A backup on the same disk does not protect against losing the disk, so the
// admin panel also offers a .tar.gz download to keep somewhere else.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function createBackup({ dataDir, keep = 7 }) {
  const dir = path.join(dataDir, 'backups');
  const skip = n => /session|idem|push-keys/i.test(n);
  const jsonFiles = () => { try { return fs.readdirSync(dataDir).filter(n => n.endsWith('.json') && !skip(n)); } catch { return []; } };
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

  function run() {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, stamp()); fs.mkdirSync(target, { recursive: true });
    let n = 0, bytes = 0;
    for (const f of jsonFiles()) { try { fs.copyFileSync(path.join(dataDir, f), path.join(target, f)); bytes += fs.statSync(path.join(target, f)).size; n++; } catch { /* file changed while copying: skip */ } }
    const all = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    return { name: path.basename(target), files: n, bytes };
  }
  function list() {
    try {
      return fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()).sort().reverse().map(name => {
        const files = fs.readdirSync(path.join(dir, name)); return { name, files: files.length, bytes: files.reduce((a, f) => a + fs.statSync(path.join(dir, name, f)).size, 0) };
      });
    } catch { return []; }
  }
  // streams a .tar.gz of the current data files (plus uploaded PDFs when asked) to `res`
  function download(res, includePdfs) {
    const args = ['-czf', '-', '-C', dataDir, ...jsonFiles()];
    if (includePdfs && fs.existsSync(path.join(dataDir, 'curriculum-pdfs'))) args.push('curriculum-pdfs');
    const tar = spawn('tar', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="taallam-backup-' + stamp() + '.tar.gz"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    tar.stdout.pipe(res); tar.on('error', () => res.end());
  }
  function schedule() {
    const t1 = setTimeout(() => { try { run(); } catch { /* retry tomorrow */ } }, 90 * 1000); t1.unref();
    const t2 = setInterval(() => { try { run(); } catch { /* retry tomorrow */ } }, 24 * 3600 * 1000); t2.unref();
  }
  return { run, list, download, schedule };
};
