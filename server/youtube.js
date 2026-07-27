import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const COOKIE_FILE = path.resolve(process.cwd(), '../yt-cookies.txt');

export function handleYoutubeCookies(app) {
  app.post('/api/admin/yt-cookies', (req, res) => {
    const token = req.headers['authorization'];
    if (token !== `Bearer ${process.env.ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        const { cookies } = JSON.parse(body);
        if (!cookies) {
          return res.status(400).json({ error: 'missing_cookies' });
        }
        fs.writeFileSync(COOKIE_FILE, cookies, { mode: 0o600 });
        res.json({ success: true });
      } catch (err) {
        console.error('Failed to write cookies:', err);
        res.status(500).json({ error: 'write_failed' });
      }
    });
  });
}

export function getCookieFilePath() {
  return fs.existsSync(COOKIE_FILE) ? COOKIE_FILE : null;
}

export function resolveYoutubeDirect(url) {
  return new Promise((resolve, reject) => {
    const args = ['-j'];
    const cookiePath = getCookieFilePath();
    if (cookiePath) {
      args.push('--cookies', cookiePath);
    }
    args.push(url);

    const proc = spawn('yt-dlp', args);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('yt-dlp failed'));
      try {
        const info = JSON.parse(out);
        resolve(info.url);
      } catch(e) {
        reject(e);
      }
    });
  });
}
