// Generate the USGRP | Utilities bot logo via Vertex AI Nano Banana Pro
// (gemini-3-pro-image — renders text correctly). Writes the PNG to argv[2].
// Token passed in env VERTEX_TOKEN. Matches the USGRP | Government seal style.
import { writeFileSync } from 'node:fs';

const PROJ = 'gen-lang-client-0856010463';
const TOKEN = process.env.VERTEX_TOKEN;
const OUT = process.argv[2] || '/home/vpcommunityorganisation/utilities-logo.png';

const prompt = `A polished, professional circular emblem logo to be used as the profile picture for an official United States federal "USGRP Utilities" operations Discord bot.

Design: an official federal-seal style roundel matching a navy-and-gold government insignia set. At the center, a large polished gold mechanical gear/cog interlocked with a smaller gear, with a heraldic shield bearing red, white and blue stripes mounted in front of the gears, and a small golden eagle head crest above. Set on a deep navy-blue field, enclosed by a thick polished gold ring. Across the ring: the word "USGRP" in bold gold serif capital letters at the top, and the word "UTILITIES" in clean gold capitals at the bottom, separated by a small gold star on each side. A subtle ring of small gold stars inside the border.

Style: crisp, high-detail, modern official insignia, rich navy and gold with red/white/blue accents, soft realistic lighting, vector-clean edges. Centered, perfectly symmetrical, square 1:1 composition. The navy seal fills the frame so it reads well when cropped to a circle. Solid deep-navy background filling the corners. No watermark, no extra text, spelling exactly "USGRP" and "UTILITIES".`;

const url = `https://aiplatform.googleapis.com/v1/projects/${PROJ}/locations/global/publishers/google/models/gemini-3-pro-image:generateContent`;
const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
});
if (!r.ok) { console.error('HTTP', r.status, (await r.text()).slice(0, 500)); process.exit(1); }
const j = await r.json();
const parts = j.candidates?.[0]?.content?.parts || [];
const img = parts.find((p) => p.inlineData?.data);
if (!img) { console.error('no image:', JSON.stringify(j).slice(0, 500)); process.exit(1); }
writeFileSync(OUT, Buffer.from(img.inlineData.data, 'base64'));
console.log('wrote', OUT, Buffer.from(img.inlineData.data, 'base64').length, 'bytes');
