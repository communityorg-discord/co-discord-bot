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

// Expand abbreviations so TTS reads them as individual letters
function expandForSpeech(text) {
  return text
    .replace(/\bCO\s*\|\s*/g, 'C. O. ')
    .replace(/\bCO\b/g, 'C. O.')
    .replace(/\bDMSPC\b/g, 'D. M. S. P. C.')
    .replace(/\bDCOS\b/g, 'D. C. O. S.')
    .replace(/\bDGACM\b/g, 'D. G. A. C. M.')
    .replace(/\bDSS\b/g, 'D. S. S.')
    .replace(/\bIAC\b/g, 'I. A. C.')
    .replace(/\bUSG\b/g, 'U. S. G.')
    .replace(/\bASG\b/g, 'A. S. G.')
    .replace(/\bDSG\b/g, 'D. S. G.')
    .replace(/\bEOB\b/g, 'E. O. B.')
    .replace(/\bBOD\b/g, 'B. O. D.')
    .replace(/\bIC\b/g, 'I. C.')
    .replace(/\bSG\b/g, 'S. G.');
}

async function speakRecordingNotice(connection, voiceChannel, recordingDir, recordingId) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/London' });

  const h = parseInt(now.toLocaleString('en-GB', { hour: 'numeric', hour12: true, timeZone: 'Europe/London' }));
  const m = now.getMinutes();
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const minuteStr = m === 0 ? "o'clock" : m < 10 ? `oh ${m}` : String(m);
  const timeStr = `${h} ${minuteStr} ${ampm}`;

  await voiceChannel.guild.members.fetch();
  const presentMembers = voiceChannel.members
    .filter(m => !m.user.bot)
    .map(m => expandForSpeech(m.displayName || m.user.username));
  const presentList = presentMembers.length > 0 ? presentMembers.join(', ') : 'no members detected';

  const sentences = [
    'This voice channel is now being recorded, in line with the Community Organisation Internal Staff Policy.',
    `The date is ${dateStr}.`,
    `The time is ${timeStr}.`,
    `The following members are present: ${presentList}.`,
    'For the records, could the Chair please state the Case Number before beginning the meeting.',
  ].map(expandForSpeech);

  const ffmpegPath = (await import('ffmpeg-static')).default;
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);

  // Open a PCM file to capture the notice audio directly
  const noticeTrackPath = join(recordingDir, 'BOT_Notice.pcm');
  const noticeFileStream = createWriteStream(noticeTrackPath);

  for (const sentence of sentences) {
    const parts = googleTTS.getAllAudioUrls(sentence, { lang: 'en-GB', slow: false });
    const mp3Buffers = [];
    for (const part of parts) {
      const res = await fetch(part.url);
      mp3Buffers.push(Buffer.from(await res.arrayBuffer()));
    }

    const tmpMp3 = join(tmpdir(), `co_notice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    writeFileSync(tmpMp3, Buffer.concat(mp3Buffers));

    // Convert MP3 → PCM, capture chunks for both file write and Discord playback
    const ff = spawn(ffmpegPath, ['-i', tmpMp3, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });

    const pcmChunks = [];
    ff.stdout.on('data', (chunk) => {
      pcmChunks.push(chunk);
      noticeFileStream.write(chunk); // Write to recording file
    });

    await new Promise(resolve => ff.stdout.on('end', resolve));

    // Play the collected PCM to Discord
    const { Readable } = await import('stream');
    const pcmBuffer = Buffer.concat(pcmChunks);
    const resource = createAudioResource(Readable.from(pcmBuffer), { inputType: StreamType.Raw });

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

  noticeFileStream.end();

  // Register the bot notice as a recording participant
  db.prepare(`
    INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path)
    VALUES (?, ?, ?, ?)
  `).run(recordingId, 'BOT', 'CO Bot (Recording Notice)', noticeTrackPath);

  console.log('[Recording] Notice spoken and captured to file');
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

  function subscribeUser(userId) {
    // If already actively subscribed with a live stream, skip
    if (activeStreams.has(userId)) {
      const existing = activeStreams.get(userId);
      if (!existing.audioStream.destroyed) return;
    }

    const member = channel.members.get(userId);
    const username = member?.user?.tag || userId;
    const safeName = username.replace(/[^a-z0-9_-]/gi, '_');
    const filePath = join(recordingDir, `${userId}_${safeName}.pcm`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterInactivity, duration: 300000 } // 5 min inactivity before closing
    });

    const decoder = new OpusScript(48000, 2);
    const fileStream = createWriteStream(filePath, { flags: 'a' });

    audioStream.on('data', (chunk) => {
      try {
        const pcm = decoder.decode(chunk);
        fileStream.write(pcm);
      } catch {}
    });

    // When stream ends (after 5min silence), allow re-subscription on next speak
    audioStream.on('end', () => {
      console.log(`[Recording] Stream ended for ${username} — will re-subscribe on next speak`);
      activeStreams.delete(userId);
    });
    audioStream.on('error', (e) => {
      console.error(`[Recording] Stream error for ${username}:`, e.message);
      activeStreams.delete(userId);
    });

    activeStreams.set(userId, { audioStream, fileStream, filePath, username, decoder });

    db.prepare(`
      INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path)
      VALUES (?, ?, ?, ?)
    `).run(recordingId, userId, username, filePath);

    console.log(`[Recording] Subscribed track for ${username}`);
  }

  // Re-subscribe every time someone starts speaking (handles silence gaps)
  receiver.speaking.on('start', (userId) => subscribeUser(userId));

  // Store in active map
  activeRecordings.set(channel.guild.id, {
    connection, receiver, activeStreams, recordingId, recordingKey, recordingDir, startedBy, channelName: channel.name, channel
  });

  // NOW speak the notice — also writes PCM directly to recording file
  try {
    await speakRecordingNotice(connection, channel, recordingDir, recordingId);
  } catch (e) {
    console.error('[Recording] Could not speak notice:', e.message);
  }

  return { recordingId, recordingKey, accessCode };
}

export async function stopRecording(guildId) {
  const recording = activeRecordings.get(guildId);
  if (!recording) throw new Error('No active recording found in this server.');

  const { connection, activeStreams, recordingId, recordingKey, recordingDir, channelName } = recording;

  // Destroy all audio streams and flush file writers
  for (const [userId, stream] of activeStreams) {
    try { stream.audioStream?.destroy(); } catch {}
    // Wait for file stream to flush completely
    await new Promise(resolve => {
      if (!stream.fileStream || stream.fileStream.writableEnded) return resolve();
      stream.fileStream.end(() => resolve());
    });
    const size = existsSync(stream.filePath) ? (await import('fs')).statSync(stream.filePath).size : 0;
    console.log(`[Recording] Closed track for ${stream.username} — ${Math.round(size / 192000)}s of audio (${size} bytes)`);
  }

  await new Promise(r => setTimeout(r, 3000));
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
