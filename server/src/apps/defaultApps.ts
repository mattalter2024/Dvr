import type { StreamingApp } from '../types/index.js';

/**
 * Default whole-house Streaming Apps catalog.
 * Easily extensible via Settings / Apps UI, POST /api/apps, or by adding entries here.
 */
export const DEFAULT_STREAMING_APPS: StreamingApp[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    tagline: 'Movies, series, documentaries & originals',
    category: 'Subscription',
    webUrl: 'https://www.netflix.com',
    androidPackage: 'com.netflix.ninja',
    fallbackAndroidPackage: 'com.netflix.mediaclient',
    brandColor: '#b91c1c',
    monogram: 'N',
    pinned: true,
    enabled: true,
    sortOrder: 10,
  },
  {
    id: 'hbo-max',
    name: 'HBO Max',
    tagline: 'HBO originals, Warner Bros. films & series',
    category: 'Subscription',
    webUrl: 'https://play.max.com',
    androidPackage: 'com.wbd.stream',
    fallbackAndroidPackage: 'com.hbo.hbonow',
    brandColor: '#1d4ed8',
    monogram: 'MAX',
    pinned: true,
    enabled: true,
    sortOrder: 20,
  },
  {
    id: 'pluto-tv',
    name: 'Pluto TV',
    tagline: 'Free live TV channels & on-demand movies',
    category: 'Free TV',
    webUrl: 'https://pluto.tv',
    androidPackage: 'tv.pluto.android',
    fallbackAndroidPackage: null,
    brandColor: '#a16207',
    monogram: 'PLUTO',
    pinned: true,
    enabled: true,
    sortOrder: 30,
  },
];
