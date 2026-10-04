/** One-command, reproducible render against an isolated LOCAL demonstration. */
import {spawn} from 'node:child_process';
import {mkdir, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureSite} from './capture-site.mjs';
import {generateSoundtracks} from './generate-audio.mjs';

const videoDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = resolve(videoDir, '..');
const cli = join(videoDir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const ffmpeg = join(videoDir, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const output = join(videoDir, 'output');
const silent = join(output, 'Delta-Force-Club-Hub_no-voice.mp4');
const narrated = join(output, 'Delta-Force-Club-Hub_documentary.mp4');
const chrome = process.env.VIDEO_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const reuseAssets = process.argv.includes('--reuse-assets');

async function run(executable, args, cwd, title, heartbeat = false) {
  console.log(`\n[video] ${title}`);
  await new Promise((done, reject) => {
    const child = spawn(executable, args, {cwd, stdio: 'inherit', windowsHide: true});
    const started = Date.now();
    const timer = heartbeat ? setInterval(() => {
      console.log(`[video] Rendering continues (${Math.round((Date.now() - started) / 1000)} s elapsed)`);
    }, 30_000) : null;
    const finish = (callback) => (value) => {if (timer) clearInterval(timer); callback(value);};
    child.on('error', finish(reject));
    child.on('exit', finish((code) => code === 0 ? done() : reject(new Error(`${title} exited ${code}`))));
  });
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('Video rendering requires Node.js 22 or newer.');
  }
  await mkdir(output, {recursive: true});
  if (!reuseAssets && !process.env.VIDEO_SKIP_CAPTURE) {
    await run(process.execPath, [join(rootDir, 'node_modules', 'vinext', 'dist', 'cli.js'), 'build'], rootDir, 'Build the current Club Hub source');
    console.log('[video] Replaying the product against a fresh local-only D1 database');
    await captureSite();
  }
  if (!reuseAssets && !process.env.VIDEO_SKIP_AUDIO) {
    console.log('[video] Generating original music, SFX, Mandarin narration, and SRT');
    await generateSoundtracks();
  }
  const browserFlags = process.platform === 'win32' ? [`--browser-executable=${chrome}`] : [];
  await run(process.execPath, [
    cli, 'render', 'src/index.ts', 'Film', silent,
    '--codec=h264', '--pixel-format=yuv420p', '--crf=18',
    `--concurrency=${process.env.VIDEO_CONCURRENCY || '4'}`, '--log=error', '--overwrite',
    ...browserFlags,
  ], videoDir, 'Render 1920×1080 / 60 fps picture with music and SFX', true);
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', silent, '-i', join(videoDir, 'public', 'audio', 'voice.wav'),
    '-filter_complex', '[0:a]volume=0.68[bed];[1:a]volume=1.32[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.94[a]',
    '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-movflags', '+faststart', '-t', '168', narrated,
  ], videoDir, 'Mix narration and finish documentary');
  const narratedBytes = (await stat(narrated)).size;
  const silentBytes = (await stat(silent)).size;
  console.log(`\n[video] Complete: ${narrated} (${Math.round(narratedBytes/1048576)} MiB)`);
  console.log(`[video] No-voice cut: ${silent} (${Math.round(silentBytes/1048576)} MiB)`);
  console.log(`[video] Subtitles: ${join(videoDir, 'subtitles.srt')}`);
}

main().catch((error) => {console.error(error); process.exitCode = 1;});
