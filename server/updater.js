import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let updateAvailableCache = false;

export async function checkUpdate() {
  try {
    await execAsync('git fetch origin');
    const { stdout: localRev } = await execAsync('git rev-parse HEAD');
    const { stdout: remoteRev } = await execAsync('git rev-parse origin/main');
    
    updateAvailableCache = localRev.trim() !== remoteRev.trim();
    return updateAvailableCache;
  } catch (err) {
    console.error('Failed to check for updates:', err);
    return false;
  }
}

// Periodically check for updates every 1 hour
setInterval(checkUpdate, 60 * 60 * 1000);

export function handleUpdater(app) {
  // Check once at startup
  checkUpdate();

  app.get('/api/update-status', (req, res) => {
    res.json({ available: updateAvailableCache });
  });

  app.post('/api/admin/update', (req, res) => {
    const token = req.headers['authorization'];
    if (token !== `Bearer ${process.env.ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Detached update process
    const child = spawn('bash', ['-c', 'sleep 1 && git pull && npm ci --omit=dev && (systemctl restart ba-man-bebin || pm2 restart all)'], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref();

    res.json({ success: true, message: 'Update started in detached mode.' });
  });
}
