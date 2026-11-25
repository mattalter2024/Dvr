import crypto from 'node:crypto';
import type { Channel, Program } from '../types/index.js';

interface ShowTemplate {
  title: string;
  subtitle: string;
  description: string;
  category: string;
  durationMin: number;
  episodePrefix?: string;
  isNew?: boolean;
  isLive?: boolean;
  rating: string;
}

const NETWORK_SCHEDULES: Record<string, ShowTemplate[]> = {
  CBS: [
    {
      title: 'Evening News Broadcast',
      subtitle: 'Top National & World Headlines',
      description: 'Live coverage of breaking national stories, weather radar, and in-depth investigative reports.',
      category: 'News',
      durationMin: 30,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Harbor Watch',
      subtitle: 'Tide of Evidence',
      description: 'Maritime investigators race to uncover a smuggling ring operating beneath the city harbor before nightfall.',
      category: 'Drama',
      durationMin: 60,
      episodePrefix: 'S06',
      isNew: true,
      rating: 'TV-14',
    },
    {
      title: 'Metro Precinct',
      subtitle: 'Cold Signal',
      description: 'Detectives trace an encrypted radio broadcast linked to an unsolved downtown heist.',
      category: 'Crime',
      durationMin: 60,
      episodePrefix: 'S03',
      isNew: true,
      rating: 'TV-14',
    },
    {
      title: 'Late Night Tonight',
      subtitle: 'Live Comedy & Musical Guests',
      description: 'Monologues, desk segments, celebrity interviews, and a live studio performance.',
      category: 'Talk',
      durationMin: 60,
      isNew: false,
      rating: 'TV-14',
    },
  ],
  NBC: [
    {
      title: 'Nightly News',
      subtitle: 'Live from Studio 3A',
      description: 'Comprehensive evening news, economic updates, and regional forecast.',
      category: 'News',
      durationMin: 30,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Sunday Night Football Preview',
      subtitle: 'Matchup Breakdown & Sideline Reports',
      description: 'Analysts break down key offensive schemes, injury reports, and playoff implications.',
      category: 'Sports',
      durationMin: 60,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Emergency Ward 9',
      subtitle: 'Double Shift',
      description: 'A winter storm strains the trauma team as a multi-car pileup fills the emergency bay.',
      category: 'Drama',
      durationMin: 60,
      episodePrefix: 'S08',
      isNew: true,
      rating: 'TV-14',
    },
    {
      title: 'The Loft',
      subtitle: 'The Roommate Clause',
      description: 'Three neighbors try to flip a rooftop greenhouse while dodging the building inspector.',
      category: 'Comedy',
      durationMin: 30,
      episodePrefix: 'S02',
      isNew: true,
      rating: 'TV-PG',
    },
  ],
  FOX: [
    {
      title: 'Gridiron Live',
      subtitle: 'Postgame Highlights & Analysis',
      description: 'Live studio breakdown of today’s marquee matchups and game-winning drives.',
      category: 'Sports',
      durationMin: 60,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Master Kitchen Challenge',
      subtitle: 'Mystery Box Finale',
      description: 'Home chefs face a 45-minute mystery pantry challenge judged by Michelin-starred mentors.',
      category: 'Reality',
      durationMin: 60,
      episodePrefix: 'S11',
      isNew: true,
      rating: 'TV-PG',
    },
    {
      title: 'Frontier Rescue',
      subtitle: 'Avalanche Ridge',
      description: 'Mountain search-and-rescue paramedics deploy a chopper during a whiteout.',
      category: 'Action',
      durationMin: 60,
      episodePrefix: 'S04',
      isNew: false,
      rating: 'TV-14',
    },
    {
      title: '10 O’Clock Local News',
      subtitle: 'Weather First & Traffic',
      description: 'Local headlines, 7-day forecast, and community spotlight.',
      category: 'News',
      durationMin: 30,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
  ],
  ABC: [
    {
      title: 'World News Tonight',
      subtitle: 'Evening Edition',
      description: 'Breaking headlines from around the globe with live correspondent check-ins.',
      category: 'News',
      durationMin: 30,
      isLive: true,
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Quiz Bowl Championship',
      subtitle: 'Tournament of Champions',
      description: 'Top trivia minds compete across rapid-fire categories for the grand prize.',
      category: 'Game Show',
      durationMin: 30,
      episodePrefix: 'S14',
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Pacific Coast Cinema',
      subtitle: 'The Last Lighthouse',
      description: 'Feature film: A retired cartographer discovers an uncharted island off the northern coast.',
      category: 'Movie',
      durationMin: 120,
      isNew: false,
      rating: 'PG-13',
    },
  ],
  PBS: [
    {
      title: 'NOVA: Deep Space Signals',
      subtitle: 'Listening to the Early Universe',
      description: 'Astronomers deploy next-generation radio arrays to decode faint signals from the cosmic dawn.',
      category: 'Documentary',
      durationMin: 60,
      episodePrefix: 'S51',
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Nature: Wild Patagonia',
      subtitle: 'Land of Glaciers and Wind',
      description: 'Cinematographers track pumas and Andean condors across Patagonia’s shifting seasons.',
      category: 'Documentary',
      durationMin: 60,
      episodePrefix: 'S43',
      isNew: true,
      rating: 'TV-G',
    },
    {
      title: 'Antique Appraisal Hour',
      subtitle: 'Midwest Treasures',
      description: 'Specialists evaluate rare heirlooms, mid-century art, and historic maps brought in by visitors.',
      category: 'Lifestyle',
      durationMin: 60,
      episodePrefix: 'S28',
      isNew: false,
      rating: 'TV-G',
    },
  ],
  'The CW': [
    {
      title: 'Starfall Chronicles',
      subtitle: 'Orbital Drift',
      description: 'A ragtag salvage crew intercepts a distress beacon from a derelict research station.',
      category: 'Sci-Fi',
      durationMin: 60,
      episodePrefix: 'S02',
      isNew: true,
      rating: 'TV-14',
    },
    {
      title: 'Campus Rivals',
      subtitle: 'Homecoming Showdown',
      description: 'Tensions boil over on the field as the championship roster is announced.',
      category: 'Drama',
      durationMin: 60,
      episodePrefix: 'S05',
      isNew: false,
      rating: 'TV-14',
    },
    {
      title: 'Improv Night',
      subtitle: 'Whose Punchline?',
      description: 'Fast-paced unscripted comedy games driven by audience suggestions.',
      category: 'Comedy',
      durationMin: 30,
      episodePrefix: 'S09',
      isNew: true,
      rating: 'TV-PG',
    },
  ],
  ION: [
    {
      title: 'Federal Case Files',
      subtitle: 'Paper Trail',
      description: 'Special agents follow a complex financial trail across three jurisdictions.',
      category: 'Crime',
      durationMin: 60,
      episodePrefix: 'S12',
      isNew: false,
      rating: 'TV-14',
    },
    {
      title: 'Forensic Division',
      subtitle: 'Trace Elements',
      description: 'Lab analysts reconstruct a high-profile museum burglary from microscopic fiber evidence.',
      category: 'Crime',
      durationMin: 60,
      episodePrefix: 'S07',
      isNew: false,
      rating: 'TV-14',
    },
  ],
  MeTV: [
    {
      title: 'Classic Sci-Fi Theater',
      subtitle: 'The Signal from Sector 7',
      description: 'A timeless anthology episode exploring human nature at the edge of the unknown.',
      category: 'Classic TV',
      durationMin: 30,
      episodePrefix: 'S03',
      isNew: false,
      rating: 'TV-PG',
    },
    {
      title: 'Silver Screen Westerns',
      subtitle: 'Canyon Express',
      description: 'A frontier sheriff defends a remote rail depot against outlaws.',
      category: 'Classic TV',
      durationMin: 60,
      episodePrefix: 'S05',
      isNew: false,
      rating: 'TV-PG',
    },
    {
      title: 'Golden Age Sitcom Hour',
      subtitle: 'The Surprise Inspection',
      description: 'Classic physical comedy ensues when the boss arrives early for dinner.',
      category: 'Comedy',
      durationMin: 30,
      episodePrefix: 'S04',
      isNew: false,
      rating: 'TV-G',
    },
  ],
};

/**
 * Generates 48 hours of realistic broadcast EPG guide data starting 2 hours prior to now,
 * aligned cleanly to 30-minute broadcast slots.
 */
export function generateSamplePrograms(channels: Channel[], hoursAhead = 48): Program[] {
  const now = new Date();
  const baseMs = Math.floor((now.getTime() - 2 * 3600 * 1000) / (30 * 60 * 1000)) * (30 * 60 * 1000);
  const endHorizonMs = now.getTime() + hoursAhead * 3600 * 1000;

  const programs: Program[] = [];

  for (let chIdx = 0; chIdx < channels.length; chIdx++) {
    const ch = channels[chIdx];
    const templates = NETWORK_SCHEDULES[ch.network] ?? NETWORK_SCHEDULES.CBS;
    let cursorMs = baseMs;
    let slotIdx = chIdx; // offset starting template per channel for variety

    while (cursorMs < endHorizonMs) {
      const tmpl = templates[slotIdx % templates.length];
      const startIso = new Date(cursorMs).toISOString();
      const endMs = cursorMs + tmpl.durationMin * 60 * 1000;
      const endIso = new Date(endMs).toISOString();

      const epNumber = tmpl.episodePrefix
        ? `${tmpl.episodePrefix}E${String((slotIdx % 22) + 1).padStart(2, '0')}`
        : null;

      const hash = crypto
        .createHash('sha1')
        .update(`${ch.id}|${startIso}|${tmpl.title}`)
        .digest('hex')
        .slice(0, 16);

      const posterUrl = `/api/artwork?title=${encodeURIComponent(tmpl.title)}&category=${encodeURIComponent(tmpl.category)}&network=${encodeURIComponent(ch.network || ch.guideName)}${epNumber ? `&episode=${encodeURIComponent(epNumber)}` : ''}`;

      programs.push({
        id: `prog-${hash}`,
        channelId: ch.id,
        title: tmpl.title,
        subtitle: tmpl.subtitle,
        description: tmpl.description,
        startTime: startIso,
        endTime: endIso,
        category: tmpl.category,
        episodeNum: epNumber,
        seriesId: `series-${tmpl.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        posterUrl,
        isNew: Boolean(tmpl.isNew && slotIdx % 2 === 0),
        isLive: Boolean(tmpl.isLive),
        rating: tmpl.rating,
      });

      cursorMs = endMs;
      slotIdx++;
    }
  }

  return programs;
}
