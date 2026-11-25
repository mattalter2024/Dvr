import crypto from 'node:crypto';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface GenrePalette {
  bg1: string;
  bg2: string;
  accent: string;
  accent2: string;
  scene: 'news' | 'sports' | 'drama' | 'scifi' | 'doc' | 'comedy' | 'movie' | 'classic';
}

function pickPalette(category: string, seed: number): GenrePalette {
  const cat = category.toLowerCase();
  if (cat.includes('news') || cat.includes('talk')) {
    return { bg1: '#0f1c38', bg2: '#1b3563', accent: '#60a5fa', accent2: '#ef4444', scene: 'news' };
  }
  if (cat.includes('sport')) {
    return { bg1: '#0d231c', bg2: '#163d30', accent: '#34d399', accent2: '#93c5fd', scene: 'sports' };
  }
  if (cat.includes('sci-fi') || cat.includes('scifi')) {
    return { bg1: '#12132e', bg2: '#232052', accent: '#818cf8', accent2: '#38bdf8', scene: 'scifi' };
  }
  if (cat.includes('doc') || cat.includes('nature') || cat.includes('lifestyle')) {
    return { bg1: '#10242c', bg2: '#1b3b47', accent: '#5eead4', accent2: '#93c5fd', scene: 'doc' };
  }
  if (cat.includes('comedy') || cat.includes('game') || cat.includes('reality')) {
    return { bg1: '#23192d', bg2: '#3a2444', accent: '#f59e0b', accent2: '#fb7185', scene: 'comedy' };
  }
  if (cat.includes('movie') || cat.includes('cinema')) {
    return { bg1: '#1a1822', bg2: '#2e293b', accent: '#cbd5e1', accent2: '#60a5fa', scene: 'movie' };
  }
  if (cat.includes('classic')) {
    return { bg1: '#1c1917', bg2: '#312a26', accent: '#d6d3d1', accent2: '#a8a29e', scene: 'classic' };
  }

  // Drama / Crime / Action / General — deterministic tonal variation per title
  const variants: GenrePalette[] = [
    { bg1: '#101828', bg2: '#1f2d47', accent: '#60a5fa', accent2: '#94a3b8', scene: 'drama' },
    { bg1: '#151826', bg2: '#292e49', accent: '#93c5fd', accent2: '#cbd5e1', scene: 'drama' },
    { bg1: '#111d24', bg2: '#1e3542', accent: '#38bdf8', accent2: '#94a3b8', scene: 'drama' },
  ];
  return variants[seed % variants.length];
}

function renderSceneIllustration(palette: GenrePalette, seed: number): string {
  const shift = (seed % 40) - 20;
  switch (palette.scene) {
    case 'news':
      return `
        <!-- Broadcast newsroom globe & studio horizon -->
        <circle cx="${445 + shift}" cy="165" r="115" fill="none" stroke="${palette.accent}" stroke-opacity="0.16" stroke-width="1.5"/>
        <ellipse cx="${445 + shift}" cy="165" rx="60" ry="115" fill="none" stroke="${palette.accent}" stroke-opacity="0.14" stroke-width="1.2"/>
        <ellipse cx="${445 + shift}" cy="165" rx="115" ry="42" fill="none" stroke="${palette.accent}" stroke-opacity="0.14" stroke-width="1.2"/>
        <rect x="0" y="255" width="640" height="105" fill="#09101f" fill-opacity="0.65"/>
        <rect x="42" y="294" width="210" height="6" rx="3" fill="${palette.accent2}" fill-opacity="0.7"/>
        <rect x="42" y="308" width="320" height="4" rx="2" fill="#e2e8f0" fill-opacity="0.25"/>
      `;
    case 'sports':
      return `
        <!-- Stadium floodlights & field perspective lines -->
        <circle cx="140" cy="70" r="95" fill="${palette.accent2}" fill-opacity="0.12"/>
        <circle cx="500" cy="70" r="95" fill="${palette.accent2}" fill-opacity="0.12"/>
        <path d="M0 245 L640 245 L640 360 L0 360 Z" fill="#0b1f18" fill-opacity="0.85"/>
        <line x1="120" y1="245" x2="20" y2="360" stroke="${palette.accent}" stroke-opacity="0.22" stroke-width="2"/>
        <line x1="250" y1="245" x2="210" y2="360" stroke="${palette.accent}" stroke-opacity="0.22" stroke-width="2"/>
        <line x1="390" y1="245" x2="430" y2="360" stroke="${palette.accent}" stroke-opacity="0.22" stroke-width="2"/>
        <line x1="520" y1="245" x2="620" y2="360" stroke="${palette.accent}" stroke-opacity="0.22" stroke-width="2"/>
        <ellipse cx="320" cy="295" rx="76" ry="20" fill="none" stroke="${palette.accent}" stroke-opacity="0.28" stroke-width="2"/>
      `;
    case 'scifi':
      return `
        <!-- Deep space planetary horizon & orbital rings -->
        <circle cx="${470 + shift}" cy="130" r="88" fill="${palette.accent}" fill-opacity="0.18"/>
        <circle cx="${470 + shift}" cy="130" r="88" fill="none" stroke="${palette.accent2}" stroke-opacity="0.3" stroke-width="1.5"/>
        <ellipse cx="${470 + shift}" cy="136" rx="145" ry="24" fill="none" stroke="${palette.accent2}" stroke-opacity="0.25" stroke-width="1.5" transform="rotate(-14 ${470 + shift} 136)"/>
        <circle cx="110" cy="82" r="2" fill="#fff" fill-opacity="0.6"/>
        <circle cx="185" cy="54" r="1.5" fill="#fff" fill-opacity="0.5"/>
        <circle cx="290" cy="96" r="2" fill="#fff" fill-opacity="0.45"/>
        <circle cx="90" cy="175" r="1.5" fill="#fff" fill-opacity="0.4"/>
        <circle cx="240" cy="148" r="1.3" fill="#fff" fill-opacity="0.5"/>
      `;
    case 'doc':
      return `
        <!-- Scenic mountain range & calm horizon -->
        <circle cx="${480 + shift}" cy="95" r="46" fill="${palette.accent}" fill-opacity="0.16"/>
        <path d="M0 285 L130 175 L235 245 L360 140 L485 230 L575 180 L640 235 L640 360 L0 360 Z" fill="#09151c" fill-opacity="0.72"/>
        <path d="M0 310 L175 230 L315 285 L465 215 L640 295 L640 360 L0 360 Z" fill="#061017" fill-opacity="0.88"/>
      `;
    case 'comedy':
      return `
        <!-- Warm studio stage bokeh & spotlight arcs -->
        <circle cx="${170 + shift}" cy="130" r="90" fill="${palette.accent}" fill-opacity="0.14"/>
        <circle cx="${450 - shift}" cy="115" r="105" fill="${palette.accent2}" fill-opacity="0.13"/>
        <circle cx="330" cy="195" r="55" fill="${palette.accent}" fill-opacity="0.1"/>
        <rect x="0" y="270" width="640" height="90" fill="#120d18" fill-opacity="0.72"/>
      `;
    case 'movie':
      return `
        <!-- Widescreen theatrical silhouette & horizon glow -->
        <rect x="0" y="0" width="640" height="28" fill="#05070c" fill-opacity="0.85"/>
        <rect x="0" y="332" width="640" height="28" fill="#05070c" fill-opacity="0.85"/>
        <circle cx="${320 + shift}" cy="195" r="110" fill="${palette.accent2}" fill-opacity="0.12"/>
        <path d="M0 260 Q180 225 320 245 T640 230 L640 332 L0 332 Z" fill="#0b0d14" fill-opacity="0.82"/>
      `;
    case 'classic':
      return `
        <!-- Vintage monochrome vignette & soft horizontal broadcast scanlines -->
        <circle cx="320" cy="175" r="130" fill="#ffffff" fill-opacity="0.06"/>
        <path d="M0 265 L120 240 L120 265 L210 215 L290 215 L290 265 L440 230 L520 250 L640 220 L640 360 L0 360 Z" fill="#12100e" fill-opacity="0.8"/>
      `;
    default:
      return `
        <!-- Atmospheric city skyline / harbor reflection for Drama & Crime -->
        <circle cx="${460 + shift}" cy="110" r="92" fill="${palette.accent}" fill-opacity="0.13"/>
        <path d="M0 270 L45 270 L45 205 L95 205 L95 250 L140 250 L140 165 L195 165 L195 245 L240 245 L240 190 L295 190 L295 255 L360 255 L360 150 L425 150 L425 235 L490 235 L490 185 L550 185 L550 250 L640 250 L640 360 L0 360 Z" fill="#080e1a" fill-opacity="0.82"/>
        <line x1="0" y1="278" x2="640" y2="278" stroke="${palette.accent}" stroke-opacity="0.18" stroke-width="1.5"/>
      `;
  }
}

/**
 * Generates a crisp, restrained 16:9 (640x360) broadcast show screenshot SVG.
 * Used as fallback whenever a recording does not yet have an FFmpeg-captured JPEG frame
 * or an XMLTV program does not include an external poster URL.
 */
export function renderShowScreenshotSvg(opts: {
  title: string;
  category?: string;
  network?: string;
  episodeNum?: string | null;
}): string {
  const title = (opts.title || 'OTA Broadcast').trim();
  const category = (opts.category || 'General').trim();
  const network = (opts.network || 'OTA').trim();
  const hashHex = crypto.createHash('sha1').update(`${title}|${category}`).digest('hex');
  const seed = Number.parseInt(hashHex.slice(0, 6), 16);
  const palette = pickPalette(category, seed);

  // Split long titles neatly onto max 2 lines
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= 24) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
    if (lines.length === 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 0) lines.push(title.slice(0, 24));

  const epTag = opts.episodeNum ? ` · ${opts.episodeNum}` : '';
  const metaText = escapeXml(`${category.toUpperCase()}${epTag}`);
  const networkBug = escapeXml(network.slice(0, 10).toUpperCase());

  const titleSvg =
    lines.length === 1
      ? `<text x="36" y="308" fill="#f1f5f9" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="-0.4">${escapeXml(lines[0])}</text>`
      : `<text x="36" y="278" fill="#f1f5f9" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="27" font-weight="700" letter-spacing="-0.4">${escapeXml(lines[0])}</text>
         <text x="36" y="312" fill="#f1f5f9" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="27" font-weight="700" letter-spacing="-0.4">${escapeXml(lines[1])}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0%" y1="35%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#050811" stop-opacity="0"/>
      <stop offset="100%" stop-color="#050811" stop-opacity="0.9"/>
    </linearGradient>
  </defs>

  <rect width="640" height="360" fill="url(#bg)"/>
  ${renderSceneIllustration(palette, seed)}
  <rect width="640" height="360" fill="url(#scrim)"/>

  <!-- Subtle broadcast network bug (top-right) -->
  <rect x="526" y="22" width="90" height="28" rx="6" fill="#070b14" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.14"/>
  <text x="571" y="40" text-anchor="middle" fill="#cbd5e1" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="1">${networkBug}</text>

  <!-- Show title & subtle genre line -->
  ${titleSvg}
  <text x="36" y="336" fill="#94a3b8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="1.2">${metaText}</text>
</svg>`;
}
