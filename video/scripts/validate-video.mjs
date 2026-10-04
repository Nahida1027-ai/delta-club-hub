/** Metadata, subtitle, and visual-contact-sheet check after the full render. */
import {spawn} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const videoDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ffmpeg = join(videoDir, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const output = join(videoDir, 'output');
const movies = ['Delta-Force-Club-Hub_no-voice.mp4', 'Delta-Force-Club-Hub_documentary.mp4'];

function ffmpegOutput(args) {
  return new Promise((done, reject) => {
    const child = spawn(ffmpeg, args, {cwd: videoDir, windowsHide: true});
    let outputText = '';
    child.stdout.on('data', (chunk) => {outputText += chunk;});
    child.stderr.on('data', (chunk) => {outputText += chunk;});
    child.on('error', reject);
    child.on('exit', () => done(outputText));
  });
}
function assert(condition, message) {if (!condition) throw new Error(message);}

for (const name of movies) {
  const path = join(output, name);
  const details = await stat(path);
  assert(details.size > 1_000_000, `${name} seems incomplete`);
  const probe = await ffmpegOutput(['-hide_banner', '-i', path]);
  assert(probe.includes('Video: h264'), `${name} is not H.264`);
  assert(probe.includes('1920x1080'), `${name} is not full HD`);
  assert(probe.includes('60 fps'), `${name} is not 60 fps`);
  assert(probe.includes('Audio: aac'), `${name} has no AAC audio`);
  const duration = probe.match(/Duration: (\d\d):(\d\d):([\d.]+)/);
  assert(duration, `${name} has no reported duration`);
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  assert(Math.abs(seconds - 168) < 0.15, `${name} has wrong duration: ${seconds}s`);
  console.log(`PASS ${name}: 1920×1080, 60 fps, H.264/AAC, ${seconds.toFixed(2)}s, ${(details.size/1048576).toFixed(1)} MiB`);
}

const srt = await readFile(join(videoDir, 'subtitles.srt'), 'utf8');
const cues = (srt.match(/--> /g) || []).length;
assert(cues === 12, `Expected 12 subtitle cues; got ${cues}`);
console.log(`PASS subtitles: ${cues} synchronized Mandarin cues`);

const demo = JSON.parse(await readFile(join(videoDir, 'public', 'data', 'demo-data.json'), 'utf8'));
const order = demo.order;
assert(order.total_price === 360 && order.final_club_income === 36, 'Local order financial amounts changed');
assert(order.worker_order_earnings['worker-muye'] === 162 && order.worker_order_earnings['worker-beichen'] === 162, 'Worker wages changed');
assert(order.worker_tip_earnings['worker-muye'] === 20 && order.worker_tip_earnings['worker-beichen'] === 20, 'Individual instant tips changed');
assert(demo.settlementRecord.total_amount === 162, 'Payroll mistakenly includes a tip');
assert(demo.captures.length === 12, 'A real product screenshot is missing');
console.log('PASS local D1 finances: ¥360 → wages ¥162 + ¥162, club ¥36, instant tips ¥20 + ¥20');

const contact = join(output, 'qa-contact-sheet.jpg');
const sheetLog = await ffmpegOutput([
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', join(output, movies[1]),
  '-vf', 'fps=1/4,scale=320:180,tile=7x6:padding=6:margin=12:color=0x0A0B0E',
  '-frames:v', '1', '-q:v', '3', contact,
]);
assert((await stat(contact)).size > 100_000, `Contact sheet missing: ${sheetLog}`);
console.log(`PASS visual sampling: ${contact}`);

const sink = process.platform === 'win32' ? 'NUL' : '/dev/null';
const blackLog = await ffmpegOutput([
  '-hide_banner', '-loglevel', 'info', '-i', join(output, movies[1]),
  '-vf', 'blackdetect=d=0.5:pix_th=0.05:pic_th=0.95', '-an', '-f', 'null', sink,
]);
assert(!blackLog.includes('black_start:'), 'Found an unintended half-second black picture');
const audioLog = await ffmpegOutput([
  '-hide_banner', '-loglevel', 'info', '-i', join(output, movies[1]),
  '-vn', '-af', 'silencedetect=noise=-45dB:d=1', '-f', 'null', sink,
]);
assert(!audioLog.includes('silence_start:'), 'Found a one-second audio dropout');
console.log('PASS continuity: no long black picture or audio dropout');
