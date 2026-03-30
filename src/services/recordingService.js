import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior } from '@discordjs/voice';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { db } from '../utils/botDb.js';
import OpusScript from 'opusscript';
import googleTTS from 'google-tts-api';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG_PATH = ffmpegStatic;

const RECORDINGS_DIR = '/home/vpcommunityorganisation/clawd/recordings';

// Active recordings: guildId → { connection, timeline, recordingId, ... }
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

// ─── Single mixed timeline ────────────────────────────────────────────
// Writes ALL audio (speakers + TTS) into one shared PCM file in real-time.
// Individual speaker tracks are also kept for per-speaker downloads.
class RecordingTimeline {
  constructor(recordingDir, recordingId) {
    this.startTime = Date.now();
    // 48kHz stereo s16le = 192 bytes per ms
    this.bytesPerMs = (48000 * 2 * 2) / 1000;
    this.mixedPath = join(recordingDir, 'mixed_raw.pcm');
    this.mixedStream = createWriteStream(this.mixedPath);
    this.currentBytePos = 0;
    this.speakerFiles = new Map(); // userId → { stream, path, username }
    this.activeStreams = new Map(); // userId → { audioStream, decoder, username }
    this.currentlySpeaking = new Set(); // userIds currently producing audio
    this.speakerLastActive = new Map(); // userId → Date.now() of last audio chunk
    this.recordingDir = recordingDir;
    this.recordingId = recordingId;
    this.liveMessage = null; // Discord message to update with live status
    this.liveInterval = null;
  }

  get currentPositionMs() {
    return this.currentBytePos / this.bytesPerMs;
  }

  // Write raw PCM directly to the mixed stream (for TTS) — sequential, no gap calc
  writeDirect(chunk) {
    this.mixedStream.write(chunk);
    this.currentBytePos += chunk.length;
  }

  // Write silence to fill a gap in the mixed timeline
  writeSilenceMs(ms) {
    if (ms <= 0) return;
    const totalBytes = Math.floor(ms * this.bytesPerMs);
    // Write in ≤192 KB chunks to avoid huge allocations
    const maxChunk = 192000;
    let remaining = totalBytes;
    while (remaining > 0) {
      const sz = Math.min(remaining, maxChunk);
      this.mixedStream.write(Buffer.alloc(sz, 0));
      remaining -= sz;
    }
    this.currentBytePos += totalBytes;
  }

  // Called when a decoded PCM chunk arrives from a speaker
  writeSpeakerChunk(userId, username, pcmChunk) {
    // Create individual file on first chunk
    if (!this.speakerFiles.has(userId)) {
      const safeName = username.replace(/[^a-z0-9_-]/gi, '_');
      const filePath = join(this.recordingDir, `${userId}_${safeName}.pcm`);
      this.speakerFiles.set(userId, {
        stream: createWriteStream(filePath, { flags: 'a' }),
        path: filePath,
        username,
        offsetSeconds: (Date.now() - this.startTime) / 1000
      });

      db.prepare(`
        INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path, started_at, offset_seconds)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
      `).run(this.recordingId, userId, username, filePath, (Date.now() - this.startTime) / 1000);

      console.log(`[Recording] New speaker: ${username} (offset: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s)`);
    }

    // Track speaking activity
    this.currentlySpeaking.add(userId);
    this.speakerLastActive.set(userId, Date.now());

    // Write to individual speaker file
    this.speakerFiles.get(userId).stream.write(pcmChunk);

    // Write to mixed timeline — fill gap since last write with silence
    const chunkMs = Date.now() - this.startTime;
    const gap = chunkMs - this.currentPositionMs;
    if (gap > 1) this.writeSilenceMs(gap);

    this.mixedStream.write(pcmChunk);
    this.currentBytePos += pcmChunk.length;
  }

  // Subscribe a user to the voice receiver and pipe decoded PCM through ffmpeg for cleanup
  subscribeUser(userId, receiver, channel) {
    if (this.activeStreams.has(userId)) {
      const existing = this.activeStreams.get(userId);
      if (!existing.audioStream.destroyed) return;
    }

    const member = channel.members.get(userId);
    const username = member?.user?.tag || userId;

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterInactivity, duration: 300000 }
    });

    // Decode Opus packets → raw PCM via OpusScript
    const decoder = new OpusScript(48000, 2);

    // Pipe decoded PCM through ffmpeg with async resampling to fix timing jitter artifacts
    const ffmpegClean = spawn(FFMPEG_PATH, [
      '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
      '-af', 'aresample=async=1000:first_pts=0',
      '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    audioStream.on('data', (opusPacket) => {
      try {
        const pcm = decoder.decode(opusPacket);
        if (!ffmpegClean.stdin.destroyed) ffmpegClean.stdin.write(pcm);
      } catch {}
    });

    ffmpegClean.stdout.on('data', (cleanPcm) => {
      // Ensure chunk is aligned to stereo s16le samples (4 bytes per sample-pair)
      if (cleanPcm.length % 4 !== 0) return;
      this.writeSpeakerChunk(userId, username, cleanPcm);
    });

    // When audio stream ends (5min silence), close ffmpeg stdin to flush
    audioStream.on('end', () => {
      console.log(`[Recording] Stream ended for ${username} — will re-subscribe on next speak`);
      try { if (!ffmpegClean.stdin.destroyed) ffmpegClean.stdin.end(); } catch {}
      this.activeStreams.delete(userId);
    });
    audioStream.on('error', (e) => {
      console.error(`[Recording] Stream error for ${username}:`, e.message);
      try { if (!ffmpegClean.stdin.destroyed) ffmpegClean.stdin.end(); } catch {}
      this.activeStreams.delete(userId);
    });

    ffmpegClean.on('error', (e) => {
      console.error(`[Recording] ffmpeg decoder error for ${username}:`, e.message);
    });

    this.activeStreams.set(userId, { audioStream, decoder, ffmpegProcess: ffmpegClean, username });
  }

  // Returns current recording status for the live embed
  getStatus() {
    const now = Date.now();
    const elapsedSecs = Math.round((now - this.startTime) / 1000);
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;
    const durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Mark users as not speaking if no audio for 500ms
    for (const userId of this.currentlySpeaking) {
      const lastActive = this.speakerLastActive.get(userId) || 0;
      if (now - lastActive > 500) this.currentlySpeaking.delete(userId);
    }

    // Build participant list with speaking indicators
    const participants = [];
    for (const [userId, speaker] of this.speakerFiles) {
      if (userId === 'BOT') continue; // skip bot notice track
      const isSpeaking = this.currentlySpeaking.has(userId);
      participants.push({
        userId,
        username: speaker.username,
        isSpeaking,
      });
    }

    return { durationStr, elapsedSecs, participants, speakerCount: participants.length };
  }

  // Start the live embed update interval
  startLiveUpdates(message, channelName, startedByTag) {
    this.liveMessage = message;
    this._channelName = channelName;
    this._startedByTag = startedByTag;
    this._startTs = Math.floor(this.startTime / 1000);

    this.liveInterval = setInterval(() => this._updateLiveEmbed(), 5000);
  }

  async _updateLiveEmbed() {
    if (!this.liveMessage) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const status = this.getStatus();

      const participantLines = status.participants.length > 0
        ? status.participants.map(p => {
            const indicator = p.isSpeaking ? '🔊' : '🔇';
            return `${indicator} <@${p.userId}>`;
          }).join('\n')
        : '*Waiting for speakers...*';

      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('🔴 Recording in Progress')
        .setDescription(`Recording active in **${this._channelName}**\nStarted by **${this._startedByTag}** — <t:${this._startTs}:R>`)
        .addFields(
          { name: `Participants (${status.speakerCount})`, value: participantLines, inline: true },
          { name: 'Duration', value: `\`${status.durationStr}\``, inline: true },
        )
        .setFooter({ text: 'Use /record stop to end · Updates every 5s' })
        .setTimestamp();

      await this.liveMessage.edit({ embeds: [embed] });
    } catch (e) {
      // Message might have been deleted — stop updating
      if (e.code === 10008) {
        clearInterval(this.liveInterval);
        this.liveInterval = null;
        this.liveMessage = null;
      }
    }
  }

  stopLiveUpdates() {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    this.liveMessage = null;
  }

  // Fill timeline silence up to current real time (call before closing notice)
  catchUpToNow() {
    const nowMs = Date.now() - this.startTime;
    const gap = nowMs - this.currentPositionMs;
    if (gap > 0) this.writeSilenceMs(gap);
  }

  async close() {
    this.stopLiveUpdates();

    // End audio streams and close ffmpeg stdin to flush remaining audio
    for (const [, s] of this.activeStreams) {
      try { s.audioStream?.destroy(); } catch {}
      try { if (!s.ffmpegProcess?.stdin?.destroyed) s.ffmpegProcess.stdin.end(); } catch {}
    }

    // Wait for ffmpeg processes to flush their remaining output
    await new Promise(r => setTimeout(r, 2000));

    // Kill any remaining ffmpeg processes
    for (const [, s] of this.activeStreams) {
      try { s.ffmpegProcess?.kill('SIGTERM'); } catch {}
    }

    // Close individual speaker file streams
    for (const [, speaker] of this.speakerFiles) {
      await new Promise(resolve => {
        if (speaker.stream.writableEnded) return resolve();
        speaker.stream.end(resolve);
      });
      const size = existsSync(speaker.path) ? statSync(speaker.path).size : 0;
      console.log(`[Recording] Closed track for ${speaker.username} — ${Math.round(size / 192000)}s of audio (${size} bytes)`);
    }
    // Close mixed stream
    await new Promise(resolve => {
      if (this.mixedStream.writableEnded) return resolve();
      this.mixedStream.end(resolve);
    });
    const mixedSize = existsSync(this.mixedPath) ? statSync(this.mixedPath).size : 0;
    console.log(`[Recording] Mixed timeline closed — ${Math.round(mixedSize / 192000)}s total (${mixedSize} bytes)`);
  }
}

// ─── TTS notice functions ─────────────────────────────────────────────

async function speakTTSSentences(connection, sentences, timeline, noticeFileStream) {
  const ffmpegPath = (await import('ffmpeg-static')).default;
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);

  for (const sentence of sentences) {
    const parts = googleTTS.getAllAudioUrls(sentence, { lang: 'en-GB', slow: false });
    const mp3Buffers = [];
    for (const part of parts) {
      const res = await fetch(part.url);
      mp3Buffers.push(Buffer.from(await res.arrayBuffer()));
    }

    const tmpMp3 = join(tmpdir(), `co_tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    writeFileSync(tmpMp3, Buffer.concat(mp3Buffers));

    const ff = spawn(ffmpegPath, ['-i', tmpMp3, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });

    const pcmChunks = [];
    ff.stdout.on('data', (chunk) => {
      pcmChunks.push(chunk);
      noticeFileStream.write(chunk);
      timeline.writeDirect(chunk);
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

    // Inter-sentence pause — write silence to timeline
    timeline.writeSilenceMs(400);
    await new Promise(r => setTimeout(r, 400));
  }
}

async function speakRecordingNotice(connection, voiceChannel, timeline) {
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

  const noticeTrackPath = join(timeline.recordingDir, 'BOT_Notice.pcm');
  const noticeFileStream = createWriteStream(noticeTrackPath);

  await speakTTSSentences(connection, sentences, timeline, noticeFileStream);

  noticeFileStream.end();

  // Register bot notice as a participant for individual download
  db.prepare(`
    INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path, started_at, offset_seconds)
    VALUES (?, ?, ?, ?, datetime('now'), 0)
  `).run(timeline.recordingId, 'BOT', 'CO Bot (Recording Notice)', noticeTrackPath);

  console.log('[Recording] Opening notice spoken and written to mixed timeline');
}

async function speakClosingNotice(connection, timeline) {
  const now = new Date();
  const h = parseInt(now.toLocaleString('en-GB', { hour: 'numeric', hour12: true, timeZone: 'Europe/London' }));
  const m = now.getMinutes();
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const minuteStr = m === 0 ? "o'clock" : m < 10 ? `oh ${m}` : String(m);
  const timeStr = `${h} ${minuteStr} ${ampm}`;

  const totalMs = Date.now() - timeline.startTime;
  const durationMins = Math.floor(totalMs / 60000);
  const durationSecs = Math.round((totalMs / 1000) % 60);
  const durationStr = durationMins > 0
    ? `${durationMins} minute${durationMins !== 1 ? 's' : ''} and ${durationSecs} second${durationSecs !== 1 ? 's' : ''}`
    : `${durationSecs} second${durationSecs !== 1 ? 's' : ''}`;

  const sentences = [
    'This concludes the recorded session.',
    `The time is ${timeStr}.`,
    `Total meeting duration: ${durationStr}.`,
    'This recording will be processed and made available for download via the CO Staff Portal. Files are retained for seven days.',
    'Thank you.',
  ].map(expandForSpeech);

  // Append closing notice to existing BOT_Notice.pcm
  const noticeTrackPath = join(timeline.recordingDir, 'BOT_Notice.pcm');
  const noticeFileStream = createWriteStream(noticeTrackPath, { flags: 'a' });

  await speakTTSSentences(connection, sentences, timeline, noticeFileStream);

  noticeFileStream.end();
  console.log('[Recording] Closing notice spoken and written to mixed timeline');
}

// ─── Public API ───────────────────────────────────────────────────────

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

  const result = db.prepare(`
    INSERT INTO recordings (recording_key, guild_id, channel_id, channel_name, started_by, started_by_username, expires_at, access_code)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'), ?)
  `).run(recordingKey, channel.guild.id, channel.id, channel.name, startedBy.id, startedBy.tag, accessCode);

  const recordingId = result.lastInsertRowid;

  // Create the shared mixed timeline
  const timeline = new RecordingTimeline(recordingDir, recordingId);

  // Subscribe speakers — decoded PCM flows into both individual files and mixed timeline
  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => timeline.subscribeUser(userId, receiver, channel));

  activeRecordings.set(channel.guild.id, {
    connection, receiver, timeline, recordingId, recordingKey,
    recordingDir, startedBy, channelName: channel.name, channel
  });

  // Speak the opening notice — writes TTS PCM to mixed timeline + BOT_Notice.pcm
  try {
    await speakRecordingNotice(connection, channel, timeline);
  } catch (e) {
    console.error('[Recording] Could not speak notice:', e.message);
  }

  return { recordingId, recordingKey, accessCode };
}

export async function stopRecording(guildId) {
  const recording = activeRecordings.get(guildId);
  if (!recording) throw new Error('No active recording found in this server.');

  const { connection, timeline, recordingId, recordingKey, recordingDir } = recording;

  // Calculate duration
  const rec = db.prepare('SELECT started_at FROM recordings WHERE id = ?').get(recordingId);

  // Fill mixed timeline silence up to now, then speak closing notice
  try {
    timeline.catchUpToNow();
    await speakClosingNotice(connection, timeline);
  } catch (e) {
    console.error('[Recording] Closing notice failed:', e.message);
  }

  await new Promise(r => setTimeout(r, 1000));

  // Close all streams (speaker files + mixed file)
  await timeline.close();

  await new Promise(r => setTimeout(r, 3000));
  connection.destroy();
  activeRecordings.delete(guildId);

  const participants = db.prepare('SELECT * FROM recording_participants WHERE recording_id = ?').all(recordingId);
  const finalDurationSecs = Math.round((Date.now() - new Date(rec.started_at).getTime()) / 1000);

  db.prepare(`
    UPDATE recordings SET ended_at = datetime('now'), status = 'processing', participant_count = ?, duration_seconds = ?
    WHERE id = ?
  `).run(participants.length, finalDurationSecs, recordingId);

  // Convert mixed PCM → merged.ogg (the single pre-mixed output)
  await convertMixed(recordingDir);

  // Convert individual speaker tracks → .ogg
  await convertTracks(recordingId, participants);

  db.prepare(`UPDATE recordings SET status = 'ready' WHERE id = ?`).run(recordingId);

  return { recordingId, recordingKey, participants, recordingDir, durationSecs: finalDurationSecs };
}

async function convertMixed(recordingDir) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const ffmpegPath = (await import('ffmpeg-static')).default;

  const mixedPcm = join(recordingDir, 'mixed_raw.pcm');
  const mergedOgg = join(recordingDir, 'merged.ogg');

  if (!existsSync(mixedPcm)) {
    console.error('[Recording] mixed_raw.pcm not found — skipping merge conversion');
    return;
  }

  try {
    await execFileAsync(ffmpegPath, [
      '-y', '-f', 's16le', '-ar', '48000', '-ac', '2',
      '-i', mixedPcm,
      '-c:a', 'libvorbis', '-q:a', '5',
      mergedOgg
    ], { timeout: 300000 });
    console.log('[Recording] Converted mixed timeline → merged.ogg');
  } catch (e) {
    console.error('[Recording] Mixed conversion failed:', e.message);
  }
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
