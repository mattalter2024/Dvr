import type { Channel, TunerDevice } from '../types/index.js';

export const VIRTUAL_TUNER_ID = 'virtual-ota-1';

export interface VirtualChannelSpec {
  guideNumber: string;
  guideName: string;
  network: string;
  xmltvId: string;
  hd: boolean;
  accentHex: string;
  audioFreqHz: number;
}

export const VIRTUAL_CHANNELS: VirtualChannelSpec[] = [
  {
    guideNumber: '2.1',
    guideName: 'WCBS-HD',
    network: 'CBS',
    xmltvId: 'cbs.ota.local',
    hd: true,
    accentHex: '0x1d4ed8',
    audioFreqHz: 330,
  },
  {
    guideNumber: '4.1',
    guideName: 'WNBC-HD',
    network: 'NBC',
    xmltvId: 'nbc.ota.local',
    hd: true,
    accentHex: '0x7c3aed',
    audioFreqHz: 392,
  },
  {
    guideNumber: '5.1',
    guideName: 'WNYW-HD',
    network: 'FOX',
    xmltvId: 'fox.ota.local',
    hd: true,
    accentHex: '0xdc2626',
    audioFreqHz: 440,
  },
  {
    guideNumber: '7.1',
    guideName: 'WABC-HD',
    network: 'ABC',
    xmltvId: 'abc.ota.local',
    hd: true,
    accentHex: '0x0284c7',
    audioFreqHz: 494,
  },
  {
    guideNumber: '11.1',
    guideName: 'WPIX-HD',
    network: 'The CW',
    xmltvId: 'cw.ota.local',
    hd: true,
    accentHex: '0x059669',
    audioFreqHz: 523,
  },
  {
    guideNumber: '13.1',
    guideName: 'WNET-HD',
    network: 'PBS',
    xmltvId: 'pbs.ota.local',
    hd: true,
    accentHex: '0x2563eb',
    audioFreqHz: 587,
  },
  {
    guideNumber: '31.1',
    guideName: 'WPXN-HD',
    network: 'ION',
    xmltvId: 'ion.ota.local',
    hd: true,
    accentHex: '0xd97706',
    audioFreqHz: 659,
  },
  {
    guideNumber: '33.1',
    guideName: 'WJLP-DT',
    network: 'MeTV',
    xmltvId: 'metv.ota.local',
    hd: false,
    accentHex: '0xbe123c',
    audioFreqHz: 293,
  },
];

export function createVirtualTunerDevice(tunerCount = 2): TunerDevice {
  return {
    id: VIRTUAL_TUNER_ID,
    name: 'Virtual OTA ATSC Simulator',
    type: 'virtual',
    host: '127.0.0.1',
    deviceId: 'SIM00001',
    modelNumber: 'AIRVAULT-SIM-4K',
    tunerCount: Math.max(1, tunerCount),
    baseUrl: 'virtual://airvault-ota',
    enabled: true,
    lastSeenAt: new Date().toISOString(),
  };
}

export function createVirtualChannels(): Channel[] {
  return VIRTUAL_CHANNELS.map((spec, idx) => ({
    id: `${VIRTUAL_TUNER_ID}-ch-${spec.guideNumber}`,
    tunerId: VIRTUAL_TUNER_ID,
    guideNumber: spec.guideNumber,
    guideName: spec.guideName,
    network: spec.network,
    streamUrl: `virtual://channel/${spec.guideNumber}`,
    logoUrl: null,
    xmltvId: spec.xmltvId,
    hd: spec.hd,
    favorite: idx < 4,
    enabled: true,
  }));
}

/**
 * Builds FFmpeg input arguments for a Virtual OTA channel.
 *
 * When `injectCommercialBreaks` is true (used for recordings), the synthetic stream inserts
 * periodic black-frame + audio-silence transitions (characteristic of real OTA ad breaks) so
 * both Comskip and the built-in FFmpeg commercial detector detect real commercial blocks!
 */
export function buildVirtualFfmpegInputArgs(
  channel: Channel,
  durationSec?: number,
  injectCommercialBreaks = false,
): string[] {
  const spec =
    VIRTUAL_CHANNELS.find((c) => c.guideNumber === channel.guideNumber) ?? VIRTUAL_CHANNELS[0];

  const size = channel.hd ? '1280x720' : '854x480';
  const durationOpt = durationSec ? `:d=${Math.ceil(durationSec)}` : '';

  if (injectCommercialBreaks) {
    // Periodic simulated broadcast with black-frame + silence ad breaks:
    // Segment cycle every 45s: [0..28s show] -> [28..29s black/silence] -> [29..43s ad] -> [43..44s black/silence]
    const videoFilter = [
      `testsrc2=s=${size}:r=30${durationOpt}`,
      `geq=lum='if(between(mod(T,45),28,29.5)+between(mod(T,45),43,44.5),16,p(X,Y))':cb='if(between(mod(T,45),28,29.5)+between(mod(T,45),43,44.5),128,p(X,Y))':cr='if(between(mod(T,45),28,29.5)+between(mod(T,45),43,44.5),128,p(X,Y))'`,
    ].join(',');
    const audioFilter = [
      `sine=frequency=${spec.audioFreqHz}:sample_rate=48000${durationOpt}`,
      `volume='if(between(mod(t,45),28,29.5)+between(mod(t,45),43,44.5),0,0.18)':eval=frame`,
    ].join(',');

    return ['-re', '-f', 'lavfi', '-i', videoFilter, '-f', 'lavfi', '-i', audioFilter];
  }

  return [
    '-re',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${size}:r=30${durationOpt}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${spec.audioFreqHz}:sample_rate=48000${durationOpt}`,
  ];
}
