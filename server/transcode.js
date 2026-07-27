import { spawn } from 'child_process';
import { assertSafeUrl } from './net-guard.js';

function getMediaInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,profile',
      '-of', 'json',
      url
    ];
    const ffprobe = spawn('ffprobe', args);
    let out = '';
    ffprobe.stdout.on('data', d => out += d.toString());
    ffprobe.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        resolve(JSON.parse(out));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function transcodeStream(rawUrl, req, res) {
  let ffmpeg;
  res.on('close', () => {
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
    }
  });

  try {
    await assertSafeUrl(rawUrl);

    let mode = req.query.mode;
    if (!mode) {
      try {
        const info = await getMediaInfo(rawUrl);
        const videoStream = info.streams?.find(s => s.codec_type === 'video');
        if (videoStream) {
          const isH264 = videoStream.codec_name === 'h264';
          const is10Bit = videoStream.profile?.includes('10') || videoStream.profile?.includes('Main 10');
          if (isH264 && !is10Bit) {
            mode = 'remux';
          } else {
            mode = 'transcode';
          }
        } else {
          mode = 'transcode';
        }
      } catch (e) {
        mode = 'transcode';
      }
    }

    const args = [
      '-i', rawUrl,
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4'
    ];

    if (mode === 'remux') {
      args.push('-c', 'copy');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac');
    }

    args.push('pipe:1');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });

    ffmpeg.stdout.pipe(res);

    ffmpeg.on('error', (err) => {
      console.error('ffmpeg error', err);
      if (!res.headersSent) {
        res.status(500).send('FFmpeg error');
      } else {
        res.end();
      }
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'transcode_failed', details: err.message });
    } else {
      res.end();
    }
  }
}
