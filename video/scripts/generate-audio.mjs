/** Original 108 BPM underscore, purpose-timed sound effects, local SAPI VO and SRT. */
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cues} from './narration.mjs';

const videoDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicAudio = join(videoDir, 'public', 'audio');
const cueDir = join(publicAudio, 'cues');
const sampleRate = 44_100;
const seconds = 168;
const samples = sampleRate * seconds;
const beat = 60 / 108;

function header(bytes, channels = 2) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}
const clamp = (v) => Math.max(-1, Math.min(1, v));

async function generateMusic() {
  const target = join(publicAudio, 'music.wav');
  const stream = createWriteStream(target);
  stream.write(header(samples * 4));
  const chords = [
    [110, 130.81, 164.81], [98, 116.54, 146.83],
    [87.31, 110, 130.81], [98, 123.47, 146.83],
  ];
  for (let sec = 0; sec < seconds; sec++) {
    const buf = Buffer.alloc(sampleRate * 4);
    for (let n = 0; n < sampleRate; n++) {
      const t = sec + n / sampleRate;
      const chord = chords[Math.floor(t / (beat * 8)) % chords.length];
      const section = t < 10 ? 0.35 : t < 43 ? 0.55 : t < 93 ? 0.75 : t < 119 ? 1 : t < 150 ? 0.72 : t < 160 ? 0.8 : 0.45;
      const ending = t > 162 ? Math.max(0, 1 - (t - 162) / 6) : 1;
      const pad = chord.reduce((sum, freq, i) => sum + Math.sin(2 * Math.PI * (freq + 0.12 * i) * t + i * 0.42) * (0.5 - i * 0.09), 0) * 0.038;
      const bass = Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.092;
      const arpIndex = Math.floor(t / (beat / 2)) % 3;
      const arpTime = t % (beat / 2);
      const arp = Math.sin(2 * Math.PI * chord[arpIndex] * 2 * t) * Math.exp(-arpTime * 8) * 0.029;
      const kickTime = t % beat;
      const kick = Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-kickTime * 35)) * kickTime) * Math.exp(-kickTime * 17) * (t < 43 ? 0.015 : 0.055);
      const amount = (pad + bass + arp + kick) * section * ending;
      const sway = Math.sin(t * 0.32) * 0.035;
      buf.writeInt16LE(Math.round(clamp(amount * (1 - sway)) * 32767), n * 4);
      buf.writeInt16LE(Math.round(clamp(amount * (1 + sway)) * 32767), n * 4 + 2);
    }
    if (!stream.write(buf)) await once(stream, 'drain');
  }
  stream.end(); await once(stream, 'finish');
  return target;
}

async function generateSfx() {
  const target = join(publicAudio, 'sfx.wav');
  const pcm = new Float32Array(samples);
  const events = [
    [2.5,'tick'],[3.7,'tick'],[4.9,'tick'],[6.2,'impact'],[10.2,'whoosh'],
    [15.1,'tick'],[20.0,'tick'],[27.7,'whoosh'],[41.7,'whoosh'],[55.8,'impact'],
    [62.5,'tick'],[67.8,'whoosh'],[72.1,'tick'],[75.8,'tick'],[80.8,'impact'],
    [83.3,'whoosh'],[92.8,'impact'],[97.0,'tick'],[100.6,'whoosh'],[104.0,'tick'],
    [107.8,'tick'],[110.8,'impact'],[114.1,'tick'],[118.7,'whoosh'],
    [124.0,'tick'],[130.1,'impact'],[134.8,'whoosh'],[141.6,'tick'],
    [149.8,'impact'],[159.9,'whoosh'],[163.8,'impact'],[167.3,'tick'],
  ];
  let seed = 42;
  for (const [at, kind] of events) {
    const start = Math.floor(at * sampleRate);
    const duration = kind === 'whoosh' ? 0.68 : kind === 'impact' ? 0.48 : 0.12;
    const length = Math.min(Math.floor(duration * sampleRate), samples - start);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = (seed / 4294967296) * 2 - 1;
      const sound = kind === 'tick'
        ? (Math.sin(2*Math.PI*1250*t)*0.22 + noise*0.05) * Math.exp(-t*65)
        : kind === 'impact'
          ? (Math.sin(2*Math.PI*(75-25*t)*t)*0.18 + noise*0.045) * Math.exp(-t*12)
          : noise * Math.sin(Math.PI*t/duration) ** 2 * 0.055;
      pcm[start + i] += sound;
    }
  }
  const stream = createWriteStream(target); stream.write(header(samples * 4));
  for (let sec=0;sec<seconds;sec++) {
    const buf=Buffer.alloc(sampleRate*4);
    for(let i=0;i<sampleRate;i++){
      const value=Math.round(clamp(pcm[sec*sampleRate+i])*32767);
      buf.writeInt16LE(value,i*4); buf.writeInt16LE(value,i*4+2);
    }
    if(!stream.write(buf))await once(stream,'drain');
  }
  stream.end(); await once(stream,'finish');
  return target;
}

function cueWav(buffer) {
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw new Error('Voice cue is not WAV');
  let pos=12, rate=0, channels=0, bits=0, dataOffset=-1, dataBytes=0;
  while(pos+8<=buffer.length){
    const id=buffer.toString('ascii',pos,pos+4);const size=buffer.readUInt32LE(pos+4);
    if(id==='fmt '){channels=buffer.readUInt16LE(pos+10);rate=buffer.readUInt32LE(pos+12);bits=buffer.readUInt16LE(pos+22);}
    if(id==='data'){dataOffset=pos+8;dataBytes=size;break;}
    pos+=8+size+(size%2);
  }
  if(rate!==sampleRate||channels!==1||bits!==16||dataOffset<0)throw new Error(`Unexpected voice format ${rate}/${channels}/${bits}`);
  return {offset:dataOffset, samples:Math.floor(dataBytes/2)};
}
function srtTime(secondsValue){const ms=Math.round(secondsValue*1000);const h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60,remain=ms%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(remain).padStart(3,'0')}`;}

async function generateVoice() {
  await mkdir(cueDir,{recursive:true});
  const jsonPath=join(publicAudio,'narration-cues.json');
  await writeFile(jsonPath,JSON.stringify(cues,null,2),'utf8');
  const provided=process.env.VIDEO_VOICE_WAV;
  if(provided){
    const supplied=await readFile(provided); const parsed=cueWav(supplied);
    if(parsed.samples<sampleRate*150)throw new Error('Provided voice track must cover the film narration');
    await writeFile(join(publicAudio,'voice.wav'),supplied);
    console.log('Using externally recorded, user supplied narration');
    return;
  }
  if(process.platform!=='win32')throw new Error('Automatic narration currently needs Windows Chinese SAPI; set VIDEO_VOICE_WAV to a recorded 44.1 kHz mono WAV');
  const script=join(videoDir,'scripts','generate-voice.ps1');
  await new Promise((done,reject)=>{
    const child=spawn(process.env.VIDEO_POWERSHELL || 'powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-CueJson',jsonPath,'-OutputDirectory',cueDir],{windowsHide:true,stdio:'inherit'});
    child.on('error',reject);child.on('exit',(code)=>code===0?done():reject(new Error(`Chinese voice synthesis exited ${code}`)));
  });
  const mixed=new Int32Array(samples);
  const caption=[];
  for(let i=0;i<cues.length;i++){
    const cue=cues[i]; const wav=await readFile(join(cueDir,`cue-${String(i+1).padStart(2,'0')}.wav`));
    const info=cueWav(wav); const duration=info.samples/sampleRate;
    if(duration>cue.end-cue.start+0.7)throw new Error(`Narration cue ${i+1} exceeds its scene by ${(duration-(cue.end-cue.start)).toFixed(1)} seconds`);
    const start=Math.floor(cue.start*sampleRate);
    for(let j=0;j<info.samples&&start+j<samples;j++)mixed[start+j]+=wav.readInt16LE(info.offset+j*2);
    caption.push(`${i+1}\n${srtTime(cue.start)} --> ${srtTime(Math.min(cue.end,cue.start+duration+0.18))}\n${cue.text}\n`);
  }
  const output=Buffer.alloc(44+samples*2);header(samples*2,1).copy(output,0);
  for(let i=0;i<samples;i++)output.writeInt16LE(Math.max(-32768,Math.min(32767,mixed[i])),44+i*2);
  await writeFile(join(publicAudio,'voice.wav'),output);
  await writeFile(join(videoDir,'subtitles.srt'),caption.join('\n'),'utf8');
  console.log(`Generated ${cues.length} Chinese narration cues and synchronized SRT`);
}

export async function generateSoundtracks(){
  await mkdir(publicAudio,{recursive:true});
  await Promise.all([generateMusic(),generateSfx()]);
  await generateVoice();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))generateSoundtracks().catch(e=>{console.error(e);process.exitCode=1;});
