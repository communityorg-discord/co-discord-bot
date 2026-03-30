import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior } from '@discordjs/voice';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { db } from '../utils/botDb.js';
import OpusScript from 'opusscript';
import googleTTS from 'google-tts-api';

const RECORDINGS_DIR = '/home/vpcommunityorganisation/clawd/recordings';

// Active recordings: guildId → { connection, receiver, activeStreams, recordingId, ... }
const activeRecordings = new Map();

async function speakRecordingNotice(connection, voiceChannel) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/London' });

  // Natural spoken time — "1 o'clock", "2 thirty", "3 oh 5"
  const h = parseInt(now.toLocaleString('en-GB', { hour: 'numeric', hour12: true, timeZone: 'Europe/London' }));
  const m = now.getMinutes();
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const minuteStr = m === 0 ? "o'clock" : m < 10 ? `oh ${m}` : String(m);
  const timeStr = `${h} ${minuteStr} ${ampm}`;

  await voiceChannel.guild.members.fetch();
  const presentMembers = voiceChannel.members
    .filter(m => !m.user.bot)
    .map(m => m.displayName || m.user.username);
  const presentList = presentMembers.length > 0 ? presentMembers.join(', ') : 'no members detected';

  const sentences = [
    'This voice channel is now being recorded, in line with the Community Organisation Internal Staff Policy.',
    `The date is ${dateStr}.`,
    `The time is ${timeStr}.`,
    `The following members are present: ${presentList}.`,
    'For the records, could the Chair please state the Case Number before beginning the meeting.',
  ];

  const ffmpegPath = (await import('ffmpeg-static')).default;
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);

  for (const sentence of sentences) {
    // Download TTS for this sentence
    const parts = googleTTS.getAllAudioUrls(sentence, { lang: 'en-GB', slow: false });
    const buffers = [];
    for (const part of parts) {
      const res = await fetch(part.url);
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }

    const tmpMp3 = join(tmpdir(), `co_notice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    writeFileSync(tmpMp3, Buffer.concat(buffers));

    // Pipe through ffmpeg to PCM
    const ff = spawn(ffmpegPath, ['-i', tmpMp3, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });

    player.play(resource);
    console.log(`[TTS] Playing: "${sentence.slice(0, 60)}..."`);

    await new Promise((resolve) => {
      player.once(AudioPlayerStatus.Idle, resolve);
      player.once('error', (e) => { console.error('[TTS] Error:', e.message); resolve(); });
      setTimeout(resolve, 30000);
    });

    try { unlinkSync(tmpMp3); } catch {}
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('[Recording] Notice spoken');
}

export async function startRecording(channel, startedBy) {
  if (activeRecordings.has(channel.guild.id)) {
    throw new Error('A recording is already active in this server.');
  }

  if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR, { recursive: true });

  const recordingKey = `${channel.guild.id}_${Date.now()}`;
  const recordingDir = join(RECORDINGS_DIR, recordingKey);
  mkdirSync(recordingDir, { recursive: true });

  const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20000);

  // Handle disconnection — try to reconnect
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      console.log('[Recording] Reconnecting...');
    } catch {
      console.error('[Recording] Connection lost — cleaning up');
      activeRecordings.delete(channel.guild.id);
      connection.destroy();
    }
  });

  // DB insert
  const result = db.prepare(`
    INSERT INTO recordings (recording_key, guild_id, channel_id, channel_name, started_by, started_by_username, expires_at, access_code)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'), ?)
  `).run(recordingKey, channel.guild.id, channel.id, channel.name, startedBy.id, startedBy.tag, accessCode);

  const recordingId = result.lastInsertRowid;

  // Start receiver immediately so TTS notice is captured
  const receiver = connection.receiver;
  const activeStreams = new Map();

  receiver.speaking.on('start', (userId) => {
    if (activeStreams.has(userId)) return;

    const member = channel.members.get(userId);
    const username = member?.user?.tag || userId;
    const safeName = username.replace(/[^a-z0-9_-]/gi, '_');
    const filePath = join(recordingDir, `${userId}_${safeName}.pcm`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual }
    });

    // Decode opus to PCM using opusscript
    const decoder = new OpusScript(48000, 2);
    const fileStream = createWriteStream(filePath, { flags: 'a' });

    audioStream.on('data', (chunk) => {
      try {
        const pcm = decoder.decode(chunk);
        fileStream.write(pcm);
      } catch {}
    });
    audioStream.on('error', (e) => console.error(`[Recording] Stream error for ${username}:`, e.message));

    activeStreams.set(userId, { audioStream, fileStream, filePath, username, decoder });

    db.prepare(`
      INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path)
      VALUES (?, ?, ?, ?)
    `).run(recordingId, userId, username, filePath);

    console.log(`[Recording] Started track for ${username}`);
  });

  // Store in active map
  activeRecordings.set(channel.guild.id, {
    connection, receiver, activeStreams, recordingId, recordingKey, recordingDir, startedBy, channelName: channel.name, channel
  });

  // NOW speak the notice — receiver is already capturing
  try {
    await speakRecordingNotice(connection, channel);
  } catch (e) {
    console.error('[Recording] Could not speak notice:', e.message);
  }

  return { recordingId, recordingKey, accessCode };
}

export async function stopRecording(guildId) {
  const recording = activeRecordings.get(guildId);
  if (!recording) throw new Error('No active recording found in this server.');

  const { connection, activeStreams, recordingId, recordingKey, recordingDir, channelName } = recording;

  // Destroy all audio streams and close file writers
  for (const [userId, stream] of activeStreams) {
    try { stream.audioStream?.destroy(); } catch {}
    try { stream.fileStream?.end(); } catch {}
    console.log(`[Recording] Closed track for ${stream.username}`);
  }

  await new Promise(r => setTimeout(r, 2000));
  connection.destroy();
  activeRecordings.delete(guildId);

  const participants = db.prepare('SELECT * FROM recording_participants WHERE recording_id = ?').all(recordingId);

  // Calculate duration
  const rec = db.prepare('SELECT started_at FROM recordings WHERE id = ?').get(recordingId);
  const durationSecs = Math.round((Date.now() - new Date(rec.started_at).getTime()) / 1000);

  db.prepare(`
    UPDATE recordings SET ended_at = datetime('now'), status = 'processing', participant_count = ?, duration_seconds = ?
    WHERE id = ?
  `).run(participants.length, durationSecs, recordingId);

  // Convert PCM to FLAC using ffmpeg-static
  await convertTracks(recordingId, participants);

  db.prepare(`UPDATE recordings SET status = 'ready' WHERE id = ?`).run(recordingId);

  return { recordingId, recordingKey, participants, recordingDir, durationSecs };
}

async function convertTracks(recordingId, participants) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const ffmpegPath = (await import('ffmpeg-static')).default;

  for (const p of participants) {
    if (!p.file_path || !existsSync(p.file_path)) continue;
    const output = p.file_path.replace('.pcm', '.ogg');
    try {
      await execFileAsync(ffmpegPath, [
        '-y', '-f', 's16le', '-ar', '48000', '-ac', '2',
        '-i', p.file_path,
        '-c:a', 'libvorbis', '-q:a', '5',
        output
      ], { timeout: 60000 });
      db.prepare('UPDATE recording_participants SET file_path = ? WHERE id = ?').run(output, p.id);
      console.log(`[Recording] Converted ${p.username} to OGG`);
    } catch (e) {
      console.error(`[Recording] Convert failed for ${p.username}:`, e.message);
    }
  }
}

export function getActiveRecording(guildId) {
  return activeRecordings.get(guildId) || null;
}

export function isRecording(guildId) {
  return activeRecordings.has(guildId);
}

// Cleanup expired recordings
export async function cleanupExpiredRecordings() {
  const { rm } = await import('fs/promises');
  const expired = db.prepare(`SELECT * FROM recordings WHERE expires_at <= datetime('now') AND status != 'deleted'`).all();

  for (const rec of expired) {
    const dir = join(RECORDINGS_DIR, rec.recording_key);
    try {
      await rm(dir, { recursive: true, force: true });
      db.prepare('UPDATE recordings SET status = ?, file_path = NULL WHERE id = ?').run('deleted', rec.id);
      db.prepare('UPDATE recording_participants SET file_path = NULL WHERE recording_id = ?').run(rec.id);
      console.log(`[Recording] Deleted expired: ${rec.recording_key}`);
    } catch (e) {
      console.error(`[Recording] Cleanup failed ${rec.recording_key}:`, e.message);
    }
  }
}
