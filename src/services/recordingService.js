import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior } from '@discordjs/voice';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, writeFileSync, statSync, readFileSync, openSync, writeSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { db } from '../utils/botDb.js';
import OpusScript from 'opusscript';
import googleTTS from 'google-tts-api';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG_PATH = ffmpegStatic;
const RECORDINGS_DIR = '/home/vpcommunityorganisation/clawd/recordings';
const BYTES_PER_MS = 192; // 48kHz * 2ch * 2bytes / 1000

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

// ─── Recording timeline — stores raw Opus packets, decodes after stop ──
class RecordingTimeline {
  constructor(recordingDir, recordingId) {
    this.startTime = Date.now();
    this.speakerStreams = new Map();   // userId → { fileStream, opusPath, username, packetCount }
    this.activeAudioStreams = new Map(); // userId → { audioStream, username }
    this.currentlySpeaking = new Set();
    this.speakerLastActive = new Map();
    this.ttsSegments = [];             // { pcmPath, offsetMs }
    this.recordingDir = recordingDir;
    this.recordingId = recordingId;
    this.liveMessage = null;
    this.liveInterval = null;
  }

  // Write a raw Opus packet with its timestamp — no decoding during recording
  writeOpusPacket(userId, username, packet) {
    if (!this.speakerStreams.has(userId)) {
      const safeName = username.replace(/[^a-z0-9_-]/gi, '_');
      const opusPath = join(this.recordingDir, `${userId}_${safeName}.opus`);
      this.speakerStreams.set(userId, {
        fileStream: createWriteStream(opusPath),
        opusPath,
        username,
        packetCount: 0
      });

      db.prepare(`
        INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path, started_at, offset_seconds)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
      `).run(this.recordingId, userId, username, opusPath, (Date.now() - this.startTime) / 1000);

      console.log(`[Recording] New speaker: ${username}`);
    }

    const speaker = this.speakerStreams.get(userId);
    const ts = Date.now() - this.startTime;

    // Format: [4 bytes timestamp ms LE][2 bytes packet length LE][packet data]
    const header = Buffer.allocUnsafe(6);
    header.writeUInt32LE(ts, 0);
    header.writeUInt16LE(packet.length, 4);
    speaker.fileStream.write(header);
    speaker.fileStream.write(packet);
    speaker.packetCount++;

    // Track speaking state for live embed
    this.currentlySpeaking.add(userId);
    this.speakerLastActive.set(userId, Date.now());
  }

  // Subscribe a user — forward raw Opus packets to disk, zero processing
  subscribeUser(userId, receiver, channel) {
    if (this.activeAudioStreams.has(userId)) {
      const existing = this.activeAudioStreams.get(userId);
      if (!existing.audioStream.destroyed) return;
    }

    const member = channel.members.get(userId);
    const username = member?.user?.tag || userId;

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterInactivity, duration: 300000 }
    });

    audioStream.on('data', (packet) => {
      this.writeOpusPacket(userId, username, packet);
    });

    audioStream.on('end', () => {
      console.log(`[Recording] Stream ended for ${username} — will re-subscribe on next speak`);
      this.activeAudioStreams.delete(userId);
    });
    audioStream.on('error', (e) => {
      console.error(`[Recording] Stream error for ${username}:`, e.message);
      this.activeAudioStreams.delete(userId);
    });

    this.activeAudioStreams.set(userId, { audioStream, username });
  }

  // Register a pre-decoded TTS PCM segment with its timeline offset
  addTTSSegment(pcmPath, offsetMs) {
    this.ttsSegments.push({ pcmPath, offsetMs });
  }

  // ── Live embed status ──────────────────────────────────────────────

  getStatus() {
    const now = Date.now();
    const elapsedSecs = Math.round((now - this.startTime) / 1000);
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;
    const durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    for (const userId of this.currentlySpeaking) {
      const lastActive = this.speakerLastActive.get(userId) || 0;
      if (now - lastActive > 500) this.currentlySpeaking.delete(userId);
    }

    const participants = [];
    for (const [userId, speaker] of this.speakerStreams) {
      const isSpeaking = this.currentlySpeaking.has(userId);
      participants.push({ userId, username: speaker.username, isSpeaking });
    }

    return { durationStr, elapsedSecs, participants, speakerCount: participants.length };
  }

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

  // ── Cleanup ────────────────────────────────────────────────────────

  async close() {
    this.stopLiveUpdates();

    for (const [, s] of this.activeAudioStreams) {
      try { s.audioStream?.destroy(); } catch {}
    }

    for (const [, speaker] of this.speakerStreams) {
      await new Promise(resolve => {
        if (speaker.fileStream.writableEnded) return resolve();
        speaker.fileStream.end(resolve);
      });
      console.log(`[Recording] Closed raw track for ${speaker.username} — ${speaker.packetCount} packets`);
    }
  }
}

// ─── TTS notice functions ─────────────────────────────────────────────

async function speakTTSSentences(connection, sentences, noticeFileStream) {
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

    const ff = spawn(FFMPEG_PATH, ['-i', tmpMp3, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });

    const pcmChunks = [];
    ff.stdout.on('data', (chunk) => {
      pcmChunks.push(chunk);
      noticeFileStream.write(chunk);
    });

    await new Promise(resolve => ff.stdout.on('end', resolve));

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

    // Inter-sentence pause — write silence to the notice file
    const silence = Buffer.alloc(Math.floor(400 * BYTES_PER_MS), 0);
    noticeFileStream.write(silence);
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

  const noticePath = join(timeline.recordingDir, 'BOT_Notice_open.pcm');
  const noticeStream = createWriteStream(noticePath);
  const offsetMs = Date.now() - timeline.startTime;

  await speakTTSSentences(connection, sentences, noticeStream);

  await new Promise(resolve => noticeStream.end(resolve));
  timeline.addTTSSegment(noticePath, offsetMs);

  // Register bot notice as participant for individual download
  db.prepare(`
    INSERT OR IGNORE INTO recording_participants (recording_id, discord_id, username, file_path, started_at, offset_seconds)
    VALUES (?, ?, ?, ?, datetime('now'), 0)
  `).run(timeline.recordingId, 'BOT', 'CO Bot (Recording Notice)', noticePath);

  console.log('[Recording] Opening notice spoken and saved');
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

  const noticePath = join(timeline.recordingDir, 'BOT_Notice_close.pcm');
  const noticeStream = createWriteStream(noticePath);
  const offsetMs = Date.now() - timeline.startTime;

  await speakTTSSentences(connection, sentences, noticeStream);

  await new Promise(resolve => noticeStream.end(resolve));
  timeline.addTTSSegment(noticePath, offsetMs);

  console.log('[Recording] Closing notice spoken and saved');
}

// ─── Post-recording: decode Opus packets and build mixed timeline ─────

async function decodeAndBuildTimeline(recordingDir, recordingId, ttsSegments) {
  const participants = db.prepare('SELECT * FROM recording_participants WHERE recording_id = ?').all(recordingId);
  const speakerTracks = participants.filter(p => p.discord_id !== 'BOT' && p.file_path && existsSync(p.file_path));

  // Find total duration from all sources
  let maxEndMs = 0;

  for (const track of speakerTracks) {
    const buf = readFileSync(track.file_path);
    let pos = 0;
    while (pos + 6 <= buf.length) {
      const ts = buf.readUInt32LE(pos);
      const len = buf.readUInt16LE(pos + 4);
      pos += 6 + len;
      if (ts + 20 > maxEndMs) maxEndMs = ts + 20;
    }
  }

  for (const seg of ttsSegments) {
    if (!existsSync(seg.pcmPath)) continue;
    const segEndMs = seg.offsetMs + (statSync(seg.pcmPath).size / BYTES_PER_MS);
    if (segEndMs > maxEndMs) maxEndMs = Math.ceil(segEndMs);
  }

  maxEndMs += 100;
  const totalBytes = Math.ceil(maxEndMs * BYTES_PER_MS);
  // Ensure aligned to 4 bytes (stereo s16le sample pair)
  const alignedTotal = totalBytes - (totalBytes % 4);

  console.log(`[Recording] Building mixed timeline: ${Math.round(maxEndMs / 1000)}s, ${Math.round(alignedTotal / 1024 / 1024)}MB`);

  // Create mixed file filled with silence
  const mixedPath = join(recordingDir, 'mixed_raw.pcm');
  const fd = openSync(mixedPath, 'w');
  const silenceBlock = Buffer.alloc(192000, 0);
  for (let written = 0; written < alignedTotal;) {
    const toWrite = Math.min(silenceBlock.length, alignedTotal - written);
    writeSync(fd, silenceBlock, 0, toWrite, written);
    written += toWrite;
  }

  // Mix TTS segments (overwrite — TTS doesn't overlap with speakers at those positions)
  for (const seg of ttsSegments) {
    if (!existsSync(seg.pcmPath)) continue;
    const pcmData = readFileSync(seg.pcmPath);
    const byteOffset = Math.floor(seg.offsetMs * BYTES_PER_MS);
    const writeLen = Math.min(pcmData.length, alignedTotal - byteOffset);
    if (writeLen > 0) {
      writeSync(fd, pcmData, 0, writeLen, byteOffset);
    }
    console.log(`[Recording] Mixed TTS at ${Math.round(seg.offsetMs / 1000)}s (${Math.round(pcmData.length / 192000)}s of audio)`);
  }

  // Decode speaker Opus packets and mix into timeline
  const decoder = new OpusScript(48000, 2);

  for (const track of speakerTracks) {
    const buf = readFileSync(track.file_path);
    let pos = 0;
    let packetCount = 0;

    // Also write individual speaker PCM (with proper gaps for standalone playback)
    const individualPcmPath = track.file_path.replace('.opus', '.pcm');
    const indFd = openSync(individualPcmPath, 'w');
    let indPos = 0;
    let lastEndMs = -1;

    while (pos + 6 <= buf.length) {
      const ts = buf.readUInt32LE(pos);
      const len = buf.readUInt16LE(pos + 4);
      if (pos + 6 + len > buf.length) break;
      const packet = buf.subarray(pos + 6, pos + 6 + len);
      pos += 6 + len;

      try {
        const pcm = decoder.decode(packet);
        const byteOffset = Math.floor(ts * BYTES_PER_MS);

        // Mix into timeline: read existing samples, add incoming, clamp, write back
        const mixLen = Math.min(pcm.length, alignedTotal - byteOffset);
        if (mixLen > 0) {
          const existing = Buffer.alloc(mixLen);
          readSync(fd, existing, 0, mixLen, byteOffset);

          for (let i = 0; i + 1 < mixLen; i += 2) {
            const ex = existing.readInt16LE(i);
            const inc = pcm.readInt16LE(i);
            existing.writeInt16LE(Math.max(-32768, Math.min(32767, ex + inc)), i);
          }
          writeSync(fd, existing, 0, mixLen, byteOffset);
        }

        // Write to individual track with gap silence
        if (lastEndMs >= 0 && ts > lastEndMs) {
          const gapBytes = Math.floor((ts - lastEndMs) * BYTES_PER_MS);
          let remaining = gapBytes;
          while (remaining > 0) {
            const toWrite = Math.min(remaining, silenceBlock.length);
            writeSync(indFd, silenceBlock, 0, toWrite, indPos);
            indPos += toWrite;
            remaining -= toWrite;
          }
        }
        writeSync(indFd, pcm, 0, pcm.length, indPos);
        indPos += pcm.length;
        lastEndMs = ts + 20;

        packetCount++;
      } catch {}
    }

    closeSync(indFd);

    // Update DB to point to decoded .pcm file
    db.prepare('UPDATE recording_participants SET file_path = ? WHERE id = ?').run(individualPcmPath, track.id);
    console.log(`[Recording] Decoded ${packetCount} packets from ${track.username}`);
  }

  closeSync(fd);
  console.log('[Recording] Mixed timeline built');
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
  const timeline = new RecordingTimeline(recordingDir, recordingId);

  // Subscribe speakers — raw Opus packets written to disk, zero processing
  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => timeline.subscribeUser(userId, receiver, channel));

  activeRecordings.set(channel.guild.id, {
    connection, receiver, timeline, recordingId, recordingKey,
    recordingDir, startedBy, channelName: channel.name, channel
  });

  // Speak the opening notice — PCM saved to file for post-processing
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
  const rec = db.prepare('SELECT started_at FROM recordings WHERE id = ?').get(recordingId);

  // Speak closing notice before disconnecting
  try {
    await speakClosingNotice(connection, timeline);
  } catch (e) {
    console.error('[Recording] Closing notice failed:', e.message);
  }

  await new Promise(r => setTimeout(r, 1000));

  // Close all raw Opus streams
  await timeline.close();

  // Save TTS segments list before destroying the timeline reference
  const ttsSegments = [...timeline.ttsSegments];

  await new Promise(r => setTimeout(r, 2000));
  connection.destroy();
  activeRecordings.delete(guildId);

  const participants = db.prepare('SELECT * FROM recording_participants WHERE recording_id = ?').all(recordingId);
  const finalDurationSecs = Math.round((Date.now() - new Date(rec.started_at).getTime()) / 1000);

  db.prepare(`
    UPDATE recordings SET ended_at = datetime('now'), status = 'processing', participant_count = ?, duration_seconds = ?
    WHERE id = ?
  `).run(participants.length, finalDurationSecs, recordingId);

  // Decode all Opus packets offline and build the mixed timeline
  console.log('[Recording] Starting offline decode and mix...');
  await decodeAndBuildTimeline(recordingDir, recordingId, ttsSegments);

  // Convert mixed PCM → merged.ogg
  await convertMixed(recordingDir);

  // Convert individual speaker PCM → .ogg
  const updatedParticipants = db.prepare('SELECT * FROM recording_participants WHERE recording_id = ?').all(recordingId);
  await convertTracks(recordingId, updatedParticipants);

  db.prepare(`UPDATE recordings SET status = 'ready' WHERE id = ?`).run(recordingId);

  return { recordingId, recordingKey, participants: updatedParticipants, recordingDir, durationSecs: finalDurationSecs };
}

async function convertMixed(recordingDir) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const mixedPcm = join(recordingDir, 'mixed_raw.pcm');
  const mergedOgg = join(recordingDir, 'merged.ogg');

  if (!existsSync(mixedPcm)) {
    console.error('[Recording] mixed_raw.pcm not found — skipping merge conversion');
    return;
  }

  try {
    await execFileAsync(FFMPEG_PATH, [
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

  for (const p of participants) {
    if (!p.file_path || !existsSync(p.file_path)) continue;
    // Only convert .pcm files (skip .opus raw files, skip already-converted .ogg)
    if (!p.file_path.endsWith('.pcm')) continue;
    const output = p.file_path.replace('.pcm', '.ogg');
    try {
      await execFileAsync(FFMPEG_PATH, [
        '-y', '-f', 's16le', '-ar', '48000', '-ac', '2',
        '-i', p.file_path,
        '-c:a', 'libvorbis', '-q:a', '5',
        output
      ], { timeout: 120000 });
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
