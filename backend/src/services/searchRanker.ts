// ════════════════════════════════════════════════════════════════

import {
  popularityScore,
  coverPenalty,
  originalIndicatorBonus,
  MAJOR_INTERNATIONAL_ARTISTS,
  MAJOR_INDIAN_ARTISTS,
} from "./scoringUtils.js";
import { PHONETIC_CORRECTIONS } from "../data/artistDictionary.js";
import { getTelemetryScoreBoost } from "./telemetryStore.js";
import { correctTypoEnhanced } from "../data/entityDictionary.js";

export interface RankedSong {
  id: string;
  name: string;
  primaryArtists: string;
  image: string;
  album: string;
  duration: number;
  language: string;
  year: string;
  releaseDate?: string;
  streamUrl: string | null;
  downloadUrl: any[] | null;
  playCount: number;
  _score?: number; // internal only, stripped before response
}

export interface UserPersonalizationContext {
  favoriteArtists?: Set<string>;
  preferredLanguages?: Set<string>;
  likedSongIds?: Set<string>;
}

// ── MOOD DICTIONARY & DETECTORS ────────────────────────────────
export const MOOD_KEYWORDS_MAP: Record<string, string[]> = {
  sad: [
    "sad", "breakup", "heartbreak", "emotional", "crying", "cry", "pain", "alone",
    "sogam", "soga padal", "dard", "dukhi", "gum", "melancholy", "tears", "lonely",
    "broken heart", "feeling low", "depression", "feeling sad"
  ],
  romantic: [
    "romantic", "love", "romance", "crush", "couple", "kadhal", "pyaar", "ishq",
    "mohabbat", "prema", "valantine", "sweetheart", "melody love"
  ],
  item: [
    "item", "item song", "item songs", "items", "item dance", "item padal",
    "kuthu", "kuthu songs", "kuthu song", "item dance songs", "masala song",
    "masala songs", "glamour song", "glamour songs", "dance number"
  ],
  party: [
    "party", "dance", "club", "dj", "banger", "koothu", "kuthu", "gaana",
    "celebration", "dhol", "nach", "fast beat", "bass boosted", "item", "items", "item song", "item songs"
  ],
  chill: [
    "chill", "relax", "peaceful", "calm", "lofi", "lo-fi", "sleep", "soothing",
    "slowed", "acoustic", "meditation", "rest"
  ],
  workout: [
    "workout", "gym", "motivation", "motivational", "energy", "fitness", "running",
    "pump", "beast mode", "power"
  ],
  happy: [
    "happy", "joy", "feel good", "positive", "cheerful", "upbeat", "smile"
  ],
  devotional: [
    "devotional", "bhakti", "prayer", "god", "spiritual", "bhajan", "aarti",
    "mantra", "pooja", "amman", "murugan", "shiva", "krishna"
  ],
  melody: [
    "melody", "melodies", "evergreen", "retro", "90s", "80s", "golden hits", "classics"
  ],
  folk: [
    "folk", "mass", "local", "village", "thara local", "street", "marana mass"
  ],
};

export const KNOWN_LANGUAGES = [
  "tamil", "hindi", "telugu", "punjabi", "malayalam",
  "kannada", "english", "bengali", "marathi", "bhojpuri", "gujarati"
];

export function detectMood(query: string): string | null {
  const lower = query.toLowerCase();
  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS_MAP)) {
    for (const kw of keywords) {
      const reg = new RegExp(`(^|\\s)${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}($|\\s)`, "i");
      if (reg.test(lower)) {
        return mood;
      }
    }
  }
  return null;
}

export function detectLanguageInQuery(query: string): string | null {
  const lower = query.toLowerCase();
  for (const lang of KNOWN_LANGUAGES) {
    const reg = new RegExp(`(^|\\s)${lang}($|\\s)`, "i");
    if (reg.test(lower)) {
      return lang;
    }
  }
  return null;
}

// ── THE MAIN RANKING FUNCTION ──────────────────────────────────
export function rankSearchResults(
  songs: RankedSong[],
  query: string,
  preferredLang?: string,
  knownArtist?: string | null,
  userContext?: UserPersonalizationContext,
  detectedMood?: string | null,
  detectedEra?: DetectedEra | null,
  pinnedIds?: Set<string>,
): RankedSong[] {
  if (!songs || songs.length === 0) return [];

  const q = query.trim().toLowerCase();
  const eraInfo = detectedEra !== undefined ? detectedEra : detectEra(q);
  const effectivePinned = pinnedIds || new Set(getKnownSongIds(q));

  // Score every song
  const scored = songs.map((song) => ({
    ...song,
    _score: computeScore(song, q, preferredLang, knownArtist, userContext, detectedMood, eraInfo, effectivePinned),
  }));

  // Sort descending by score
  scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));

  // Remove internal score field before returning
  return scored.map(({ _score, ...song }) => song);
}

// ════════════════════════════════════════════════════════════════
// SCORING ENGINE
// Every factor is documented with WHY it exists
// ════════════════════════════════════════════════════════════════

function computeScore(
  song: RankedSong,
  query: string,
  preferredLang?: string,
  knownArtist?: string | null,
  userContext?: UserPersonalizationContext,
  detectedMood?: string | null,
  detectedEra?: DetectedEra | null,
  pinnedIds?: Set<string>,
): number {
  let score = 0;

  // ── 0.5. PINNED / VERIFIED QUERY HIT BOOST (+450 pts) ────────
  if (pinnedIds && pinnedIds.has(song.id)) {
    score += 450;
  }

  const title = clean(song.name);
  const artist = clean(song.primaryArtists);
  const lang = clean(song.language);
  const q = query;

  // Split query by common separators to extract just the title part for titleMatchScore
  const parts = query.split(/\s*(?: - | – | — | by | : )\s*/i);
  let qTitle = parts[0].trim().toLowerCase();
  qTitle = qTitle
    .replace(/\s*\((?:super\s+)?slowed(?:\s+down)?(?:\s+version)?\)/i, "")
    .replace(/\s*\((?:super\s+)?sped\s+up(?:\s+version)?\)/i, "")
    .replace(/\s*\(remastered(?: \d+)?\)/i, "")
    .replace(/\s*\(live(?: version)?\)/i, "")
    .replace(/\s*\(acoustic(?: version)?\)/i, "")
    .replace(/\s*\(radio edit\)/i, "")
    .replace(/\s*\(lofi\)/i, "")
    .replace(/\s*\(slowed\s*\+\s*reverb\)/i, "")
    .trim();

  // ── 1. POPULARITY SCORE (0–80 pts) ───────────────────────────
  score += popularityScore(song.playCount);

  // ── 2. COVER / FAKE / RECREATED PENALTY (−20 to −100 pts) ────
  score += coverPenalty(title, query.toLowerCase());

  // ── 3. TITLE MATCH SCORE (0–60 pts) ──────────────────────────
  // For mood searches (e.g. "sad", "sad songs", "romantic songs"), genuine masterpieces
  // like "Kanave Kanave", "Poove Sempoove", "Pona Pogattum" don't have the word "sad" in the title.
  // We MUST NOT reward random songs that happen to have "sad" or "song" in their title!
  const isGenericMoodQuery = Boolean(detectedMood) && (
    qTitle === detectedMood ||
    qTitle === `${detectedMood} song` ||
    qTitle === `${detectedMood} songs` ||
    qTitle === `${detectedMood} hits` ||
    qTitle.startsWith(`${detectedMood} `) ||
    qTitle.endsWith(` ${detectedMood}`) ||
    qTitle.endsWith(" songs") ||
    qTitle.endsWith(" song")
  );

  if (!isGenericMoodQuery) {
    score += titleMatchScore(title, qTitle);
  }

  // ── 4. ARTIST MATCH BONUS (0–25 pts) ─────────────────────────
  score += artistMatchScore(artist, q);

  // ── 5. KNOWN ARTIST AUTHORITY (0–30 pts) ─────────────────────
  score += knownArtistBonus(artist, q);

  // ── 6. ORIGINAL INDICATOR BONUS (+10 to +20 pts) ─────────────
  score += originalIndicatorBonus(title);

  // ── 7. LANGUAGE PREFERENCE & PROFILE FORCING (+150 / −160 pts)
  score += languageScore(lang, preferredLang, userContext?.preferredLanguages, detectedMood);

  // ── 8. STREAM URL PRESENCE (0 or −40 pts) ────────────────────
  if (!song.streamUrl) score -= 40;

  // ── 9. KNOWN ARTIST MATCH (+80 or −150) ──────────────────────
  if (knownArtist) {
    const knownLower = knownArtist.toLowerCase();
    const knownParts = knownLower.split(/\s+/).filter((p) => p.length > 2);
    const matchCount = knownParts.filter((part) =>
      artist.includes(part),
    ).length;
    if (matchCount >= 2)
      score += 80;
    else if (matchCount === 1)
      score += 40;
    else score -= 150;
  }

  // ── 10. RECENCY BOOST & INTENT ALIGNMENT (+35 / −50 pts) ─────
  const qLower = q.toLowerCase();
  const isRecentRequested = /\b(new|latest|recent|viral|top|2026|2025|2024)\b/i.test(qLower);
  if (isRecentRequested && song.year) {
    const yr = parseInt(song.year, 10);
    if (yr >= 2024) score += 35;
    else if (yr >= 2020) score += 15;
  }

  // ── 10.2. ERA / DECADE FILTERING & BOOST (+220 / −250 pts) ───
  if (detectedEra) {
    let songYear = 0;
    if (song.year) {
      songYear = parseInt(song.year, 10);
    } else if (song.releaseDate) {
      songYear = parseInt(song.releaseDate.slice(0, 4), 10);
    }

    if (songYear > 0) {
      if (songYear >= detectedEra.startYear && songYear <= detectedEra.endYear) {
        score += 220; // Exact era match
      } else if (
        Math.abs(songYear - detectedEra.startYear) <= 2 ||
        Math.abs(songYear - detectedEra.endYear) <= 2
      ) {
        score += 40; // Adjacent boundary year
      } else {
        score -= 600; // Strict penalty: out-of-decade songs cannot dominate era searches
      }
    } else {
      const text = `${title} ${song.album || ""}`.toLowerCase();
      if (
        text.includes(detectedEra.era) ||
        (detectedEra.era === "80s" && (text.includes("198") || text.includes("eighties"))) ||
        (detectedEra.era === "90s" && (text.includes("199") || text.includes("nineties")))
      ) {
        score += 80;
      }
    }
  }

  // ── 10.5. MOOD RELEVANCE BOOST (+60 pts) ─────────────────────
  if (detectedMood) {
    const moodWords = MOOD_KEYWORDS_MAP[detectedMood] || [];
    const tLower = title.toLowerCase();
    const aLower = (typeof song.album === "object" ? (song.album as any)?.name || "" : song.album || "").toLowerCase();
    const matchesMoodText = moodWords.some((mw) => tLower.includes(mw) || aLower.includes(mw));
    if (matchesMoodText) {
      score += 60;
    }
    // High playcount boost for verified mood hits in the target language
    if (song.playCount > 1_000_000 && (preferredLang ? lang === preferredLang : userContext?.preferredLanguages?.has(lang))) {
      score += 30;
    }
  }

  // Penalty for secondary variations (karaoke, lullaby, workout mix, nightcore, 8d) unless explicitly requested
  const isVariationRequested = /\b(karaoke|lullaby|workout|fitness|gym|nightcore|8d|remix|lofi|slowed)\b/i.test(qLower);
  const isSongVariation = /\b(karaoke|lullaby|sleeprhymes|workout version|nightcore|8d|slowed|reverb)\b/i.test(title);
  if (isSongVariation && !isVariationRequested) {
    score -= 50;
  }

  // Multi-word song line / lyrics boost for original mega-hits
  const queryWordCount = q.split(/\s+/).filter((w) => w.length > 1).length;
  if (queryWordCount >= 3 && song.playCount > 5_000_000) {
    score += 35;
  }

  // ── 11. USER PERSONALIZATION BOOST (0–65 pts) ─────────────────
  if (userContext) {
    if (userContext.likedSongIds && song.id && userContext.likedSongIds.has(song.id)) {
      score += 25;
    }
    if (userContext.favoriteArtists && artist) {
      const songArtists = artist.split(/[,/&]+/).map((a) => a.trim().toLowerCase());
      for (const sa of songArtists) {
        if (sa && userContext.favoriteArtists.has(sa)) {
          score += 25;
          break;
        }
      }
    }
  }

  // ── 12. TELEMETRY / CTR ADAPTIVE SIGNAL (−40 to +50 pts) ─────
  if (song.id) {
    score += getTelemetryScoreBoost(q, song.id);
  }

  return score;
}



// ════════════════════════════════════════════════════════════════
// FACTOR 3 — TITLE MATCH
// ════════════════════════════════════════════════════════════════
function titleMatchScore(title: string, query: string): number {
  // Strip common suffix noise that pollutes exact matching:
  // "shape of you (official music video)" → "shape of you"
  const cleanTitle = title
    .replace(/\(official.*?\)/gi, "")
    .replace(/\[official.*?\]/gi, "")
    .replace(/official (music |lyric |audio )?video/gi, "")
    .replace(/official audio/gi, "")
    .replace(/full song/gi, "")
    .trim();

  if (cleanTitle === query) return 60; // exact match
  if (cleanTitle.startsWith(query)) return 50; // starts with query
  if (cleanTitle.includes(query)) return 40; // contains exact phrase

  // Word-level matching: how many query words appear in title?
  const qWords = query.split(/\s+/).filter((w) => w.length > 1);
  const matches = qWords.filter((w) => cleanTitle.includes(w));
  const ratio = qWords.length > 0 ? matches.length / qWords.length : 0;

  if (ratio === 1) return 30; // all words match (different order)
  if (ratio >= 0.75) return 20; // 75%+ words match
  if (ratio >= 0.5) return 10; // 50%+ words match
  if (ratio >= 0.25) return 3; // some words match
  // For queries with 3+ words (e.g. lyrics/song lines), JioSaavn matched it via lyrics
  if (qWords.length >= 3) return 15;
  return 0;
}

// ════════════════════════════════════════════════════════════════
// FACTOR 4 — ARTIST MATCH
// ════════════════════════════════════════════════════════════════
function artistMatchScore(artist: string, query: string): number {
  if (!artist) return 0;

  // User typed the artist name in the query
  const firstArtist = artist.split(",")[0].trim().toLowerCase();
  if (query.includes(firstArtist)) return 25;

  // Check any listed artist (multi-artist songs)
  if (artist.split(",").some((a) => query.includes(a.trim().toLowerCase())))
    return 15;

  // Partial word match: individual artist words appear in query
  const qWords = query.split(/\s+/);
  const artistWords = artist.toLowerCase().split(/[\s,]+/);
  const matches = qWords.filter((w) => w.length > 2 && artistWords.includes(w));
  return matches.length * 8;
}

// ════════════════════════════════════════════════════════════════
// FACTOR 5 — KNOWN ARTIST AUTHORITY
// If the song artist is a major/known artist, it is almost certainly
// the original recording, not a cover.
// ════════════════════════════════════════════════════════════════



function knownArtistBonus(songArtist: string, query: string): number {
  const a = songArtist.toLowerCase();

  const isKnownInt = MAJOR_INTERNATIONAL_ARTISTS.some((ka) =>
    a.includes(ka),
  );
  const isKnownIndian = MAJOR_INDIAN_ARTISTS.some((ka) => a.includes(ka));

  if (!isKnownInt && !isKnownIndian) return 0;

  // Does the query also mention this artist's name?
  const artistFirstWord = a.split(/[\s,]+/)[0];
  const queryMentionsArtist = query.includes(artistFirstWord);

  // Known artist AND query mentions them = very high confidence it's the original
  if (queryMentionsArtist) return 30;
  // Known artist even without name in query = probably original
  return 15;
}



// ════════════════════════════════════════════════════════════════
// FACTOR 7 — LANGUAGE PREFERENCE & PROFILE ENFORCEMENT
// ════════════════════════════════════════════════════════════════
function languageScore(
  songLang: string,
  preferredLang?: string,
  userLanguages?: Set<string>,
  detectedMood?: string | null,
): number {
  if (!songLang) return 0;
  const sLang = songLang.toLowerCase().trim();

  // 1. Explicit Target/Filter Language (e.g. user selected Tamil or passed lang=tamil)
  if (preferredLang) {
    const pLang = preferredLang.toLowerCase().trim();
    if (sLang === pLang) return 180; // Decisively boost requested language
    // Heavy penalty for non-matching languages when a language is specifically requested
    return sLang === "english" ? -40 : -450;
  }

  // 2. User Profile preferred languages (e.g. from user profile / preferences)
  if (userLanguages && userLanguages.size > 0) {
    if (userLanguages.has(sLang)) {
      return detectedMood ? 180 : 80; // Extra heavy boost for user's profile languages on mood searches
    }
    // If user has language preferences and is searching a mood (like "sad"), strictly suppress foreign languages
    if (detectedMood) {
      return sLang === "english" ? -40 : -450;
    }
    return sLang === "english" ? 5 : -50;
  }

  return 0;
}

// ── HELPER ────────────────────────────────────────────────────
function clean(str: string): string {
  return (str || "").toLowerCase().trim();
}

// ════════════════════════════════════════════════════════════════
// DEDUPLICATION
// Removes duplicate songs (same title + same artist, slightly different
// names like "Shape of You" and "Shape of You (Official Audio)").
// When dupes are found, always keep the higher play-count version.
// ════════════════════════════════════════════════════════════════
export function deduplicateResults(songs: RankedSong[]): RankedSong[] {
  const seen = new Map<string, RankedSong>();

  for (const song of songs) {
    // Normalise title: strip parenthetical suffixes and "official" tails
    const titleKey = song.name
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/official.*$/i, "")
      .trim();

    const artistKey = (song.primaryArtists || "")
      .split(",")[0]
      .toLowerCase()
      .trim();

    const key = `${titleKey}::${artistKey}`;

    if (!seen.has(key)) {
      seen.set(key, song);
    } else {
      // Keep the version with higher play count
      const existing = seen.get(key)!;
      if (song.playCount > existing.playCount) {
        seen.set(key, song);
      }
    }
  }

  return Array.from(seen.values());
}

// ════════════════════════════════════════════════════════════════
// KNOWN SONGS — song title → canonical artist
// When the user searches one of these, we inject the artist name
// into the JioSaavn query so the wrapper actually returns the
// original (it's buried without the artist name in the query).
// ════════════════════════════════════════════════════════════════
export const KNOWN_SONGS: Record<string, string> = {
  // English
  "shape of you": "Ed Sheeran",
  "blinding lights": "The Weeknd",
  stay: "Justin Bieber",
  "bad guy": "Billie Eilish",
  "drivers license": "Olivia Rodrigo",
  levitating: "Dua Lipa",
  "anti-hero": "Taylor Swift",
  "as it was": "Harry Styles",
  flowers: "Miley Cyrus",
  "easy on me": "Adele",
  hello: "Adele",
  "rolling in the deep": "Adele",
  "someone like you": "Adele",
  perfect: "Ed Sheeran",
  "thinking out loud": "Ed Sheeran",
  photograph: "Ed Sheeran",
  "castle on the hill": "Ed Sheeran",
  despacito: "Luis Fonsi",
  believer: "Imagine Dragons",
  faded: "Alan Walker",
  closer: "The Chainsmokers",
  peaches: "Justin Bieber",
  "good 4 u": "Olivia Rodrigo",
  "new rules": "Dua Lipa",
  "dont start now": "Dua Lipa",
  "watermelon sugar": "Harry Styles",
  butter: "BTS",
  dynamite: "BTS",
  // Movie OSTs
  "zeus law": "Ludwig Goransson",
  "zeus's law": "Ludwig Goransson",
  sirens: "Travis Scott",
  "when i'm home": "Ludwig Goransson",
  "katchi sera": "Sai Abhyankkar",
  illuminati: "Sushin Shyam",
  hukum: "Anirudh Ravichander",
  "arabic kuthu": "Anirudh Ravichander",
  // Hindi
  kesariya: "Arijit Singh",
  "tum hi ho": "Arijit Singh",
  "channa mereya": "Arijit Singh",
  "ae dil hai mushkil": "Arijit Singh",
  bekhayali: "Sachet Tandon",
  kabira: "Rekha Bhardwaj",
  // Tamil
  kannazhaga: "Sid Sriram",
  kuththu: "Anirudh Ravichander",
  "vaathi coming": "Anirudh Ravichander",
  mersalaayitten: "Anirudh Ravichander",
  "aalaporaan tamizhan": "Anirudh Ravichander",
  "beast mode": "Anirudh Ravichander",
  "venpani malare": "Sid Sriram",
  "naan autokaaran": "Deva",
  "autokaaran": "Deva",
  "vandhenda paalkaaran": "Deva",
  salomiya: "Deva",
  "kavalai padathe sagodhara": "Deva",
  "aasaiyil oru kaditham": "Deva",
  meenamma: "Deva",
  "kotta paakkum": "Deva",
  "konja naal poru thalaiva": "Deva",
  baashha: "Deva",
  basha: "Deva",
  annamalai: "Deva",
  "azhage azhage": "Uthara Unnikrishnan",
  azhage: "Uthara Unnikrishnan",
  "aasa kooda": "Sai Abhyankkar",
  "enjoy enjaami": "Dhee",
  orasaadha: "Mervin Solomon",
};

// Returns the known artist for a query, or null
export function getKnownArtist(query: string): string | null {
  return KNOWN_SONGS[query.trim().toLowerCase()] ?? null;
}

// ════════════════════════════════════════════════════════════════
// KNOWN SONG IDs — real JioSaavn IDs for songs the wrapper search
// never returns (e.g. Ed Sheeran originals buried by covers).
// Fetched directly by ID on every matching search, bypassing search index.
// To add more: search on local dev, copy the id from direct jiosaavn.com results.
// ════════════════════════════════════════════════════════════════
export const TAMIL_ITEM_SONG_IDS = [
  "NmkwfzYX", // Oo Solriya Oo Oo Solriya (Pushpa)
  "nHs_0eEA", // Kaavaalaa (Jailer)
  "aUB2VgLm", // Appadipodu (Ghilli)
  "1EMhybjY", // Kalasala Kalasala (Osthe)
  "AgeRwxTb", // Arabic Kuthu - Halamithi Habibo (Beast)
  "ahQg3u9E", // Naa Ready (Leo)
  "ymKschUl", // Aaluma Doluma (Vedalam)
  "IJ3C0q7f", // Vaathi Coming (Master)
  "mXhwLwHw", // Ringa Ringa (7aum Arivu)
  "oWRuPdt_", // Kattipudi Kattipudida (Kushi)
  "mXQLtmGw", // Pottu Thakku (Kuthu)
  "H_JGn6eH", // Chikku Bukku Rayiley (Gentleman)
  "636QEUfW", // Machi Open the Bottle (Mankatha)
  "69gtUbUv", // Danga Maari Oodhari (Anegan)
  "I6jncR_O", // Manasilaayo (Vettaiyan)
  "y2UZ6cZZ", // Seena Thana (Vasool Raja)
  "_cFy-xJa", // Saroja Saman Nikolo (Chennai 600028)
  "NG6XaUYU", // Matta (GOAT)
  "QZ0saCaM", // Pathala Pathala (Vikram)
  "gg6ID5MD", // Chellamma (Doctor)
  "BNTdBvwL", // Ta Takkara (Kalki)
];

// ── NAVARASA NAYAGAN ACTOR KARTHIK EVERGREEN HITS ───────────────
export const ACTOR_KARTHIK_SONG_IDS = [
  "RFdlNpGp", // Raaja Raajathi (Agni Natchathiram)
  "OpkzpJyV", // Ninnukori Varanam (Agni Natchathiram)
  "I95yYHce", // Oru Poonga Vanam (Agni Natchathiram)
  "htSr6ehq", // Nilaave Vaa (Mouna Ragam)
  "Bbf6pLX8", // Chinna Chinna Vanna Kuyil (Mouna Ragam)
  "71Br7RQn", // Ayiram Thamarai (Alaigal Oyvatillai)
  "3LbrtIWH", // Pachamala Poovu (Kizhakku Vaasal)
  "lAY1VhMg", // Paadi Parandha (Kizhakku Vaasal)
  "LJMWRyOG", // Azagiya Laila (Ullathai Alli Thaa)
  "fuNy3nG2", // Edho Oru Paattu (Unnidathil Ennai Koduthen)
  "qdJEhETW", // Kadhal Kavithaigal (Gopura Vaasalile)
  "jo8F6Ngv", // Thaalattum Poongaatru (Gopura Vaasalile)
  "UPAmK88q", // Keladi En Paavaiye (Gopura Vaasalile)
  "IhCXE0M8", // Priyasaki (Gopura Vaasalile)
  "jLGiBZ9c", // Pazhamuthir Cholai (Varusham Padhinaaru)
  "b3foeDJ4", // Hey Aiyasamy (Varusham Padhinaaru)
  "mLX6EVst", // Gangai Karai Mannanadi (Varusham Padhinaaru)
  "wA9q2Igf", // Velvetta Velvetta (Mettukudi)
  "a2McAxDq", // Chandirane Suriyane (Amaran)
  "7Ivrx1fT", // Musthafa Musthafa (Amaran)
];

// ── TAMIL ALL-TIME CLASSIC & MODERN SAD/HEARTBREAK MASTERPIECES ──
export const TAMIL_SAD_SONG_IDS = [
  "itXw9yrX", // Kanave Kanave (David)
  "PiRRAGim", // Poove Sempoove (Solla Thudikuthu Manasu)
  "wo8Ig0KX", // Kanne Kalaimaane (Moondram Pirai)
  "AoIGPJrx", // Pona Pogattum (Master)
  "IRMwW4Eq", // Amma Endru (Mannan)
  "KLvjpT0S", // En Kadhal Solla (Paiya)
  "sa4mKbze", // Nenjukkul Peidhidum (Vaaranam Aayiram)
  "KyRLikuY", // Oru Naalil (Pudhupettai)
  "erqgjdbl", // Venmathiye (Minnale)
  "MzOsYorg", // Thalli Pogathey (Achcham Yenbadhu Madamaiyada)
  "yZSd2-yD", // Idhazhin Oram (3)
  "qfDlsdwx", // Thendral Vandhu Theendumbothu (Avatharam)
  "41VQDqwe", // Usure Pogudhey (Raavanan)
  "Xv8O6Q_O", // Oru Dheivam Thantha Poove (Kannathil Muthamittal)
  "xpf7ivHq", // Unakkenna Venum Sollu (Yennai Arindhaal)
  "f5qzTLRh", // Nenjame Nenjame (Maamannan)
  "9BQRo0cS", // Aarariraro (Raam)
  "DKzv388T", // Maruvaarthai (Enai Noki Paayum Thota)
  "3bqwaRv5", // Urugi Urugi (Joe)
];

export const KNOWN_SONG_IDS: Record<string, string[]> = {
  "item songs": TAMIL_ITEM_SONG_IDS,
  "item song": TAMIL_ITEM_SONG_IDS,
  "items songs": TAMIL_ITEM_SONG_IDS,
  "items song": TAMIL_ITEM_SONG_IDS,
  "items tamil songs": TAMIL_ITEM_SONG_IDS,
  "item tamil songs": TAMIL_ITEM_SONG_IDS,
  "tamil item songs": TAMIL_ITEM_SONG_IDS,
  "tamil item song": TAMIL_ITEM_SONG_IDS,
  "tamil items songs": TAMIL_ITEM_SONG_IDS,
  "tamil items song": TAMIL_ITEM_SONG_IDS,
  "tamil item": TAMIL_ITEM_SONG_IDS,
  "tamil items": TAMIL_ITEM_SONG_IDS,
  "item dance songs": TAMIL_ITEM_SONG_IDS,
  "kuthu songs": TAMIL_ITEM_SONG_IDS,
  "tamil kuthu songs": TAMIL_ITEM_SONG_IDS,
  "actor karthik": ACTOR_KARTHIK_SONG_IDS,
  "actor karthik songs": ACTOR_KARTHIK_SONG_IDS,
  "actor karthik hits": ACTOR_KARTHIK_SONG_IDS,
  "karthik actor": ACTOR_KARTHIK_SONG_IDS,
  "karthik actor songs": ACTOR_KARTHIK_SONG_IDS,
  "karthik actor hits": ACTOR_KARTHIK_SONG_IDS,
  "navarasa nayagan": ACTOR_KARTHIK_SONG_IDS,
  "navarasa nayagan karthik": ACTOR_KARTHIK_SONG_IDS,
  "navarasanayagan": ACTOR_KARTHIK_SONG_IDS,
  "navarasa nayagan karthik songs": ACTOR_KARTHIK_SONG_IDS,
  "navarasa nayagan songs": ACTOR_KARTHIK_SONG_IDS,
  "karthik muthuraman": ACTOR_KARTHIK_SONG_IDS,
  "sad songs": TAMIL_SAD_SONG_IDS,
  "sad song": TAMIL_SAD_SONG_IDS,
  "tamil sad songs": TAMIL_SAD_SONG_IDS,
  "tamil sad song": TAMIL_SAD_SONG_IDS,
  "sad tamil songs": TAMIL_SAD_SONG_IDS,
  "sad tamil song": TAMIL_SAD_SONG_IDS,
  "sogam songs": TAMIL_SAD_SONG_IDS,
  "sogam song": TAMIL_SAD_SONG_IDS,
  "tamil sogam songs": TAMIL_SAD_SONG_IDS,
  "soga padalgal": TAMIL_SAD_SONG_IDS,
  "breakup songs": TAMIL_SAD_SONG_IDS,
  "tamil breakup songs": TAMIL_SAD_SONG_IDS,
  "break up songs": TAMIL_SAD_SONG_IDS,
  "feeling sad": TAMIL_SAD_SONG_IDS,
  "heartbreak songs": TAMIL_SAD_SONG_IDS,
  "tamil heartbreak songs": TAMIL_SAD_SONG_IDS,
  "shape of you": ["icJam_5l", "wwSCc15h"],
  "azhage azhage": ["k7yD9gQ5", "Bszutabj", "O1aDQiCm"],
  "azhage": ["k7yD9gQ5", "Bszutabj", "O1aDQiCm"],
  "allagea allagea": ["k7yD9gQ5", "Bszutabj", "O1aDQiCm"],
  "allagea": ["k7yD9gQ5", "Bszutabj", "O1aDQiCm"],
  "alage alage": ["k7yD9gQ5", "Bszutabj", "O1aDQiCm"],
  "tamil album songs": ["F_fgk0mb", "GUURlhr1", "x2z_VPDG", "SVhN9fzs", "P5pjB99X"],
  "album songs": ["F_fgk0mb", "GUURlhr1", "x2z_VPDG", "SVhN9fzs", "P5pjB99X"],
  "tamil album song": ["F_fgk0mb", "GUURlhr1", "x2z_VPDG", "SVhN9fzs", "P5pjB99X"],
  "album song": ["F_fgk0mb", "GUURlhr1", "x2z_VPDG", "SVhN9fzs", "P5pjB99X"],
};

export function getKnownSongIds(query: string): string[] {
  const qClean = query.trim().toLowerCase();
  if (KNOWN_SONG_IDS[qClean]) return KNOWN_SONG_IDS[qClean];
  if (/\b(items?|item\s*songs?|kuthu\s*songs?|masala\s*songs?)\b/i.test(qClean)) {
    return TAMIL_ITEM_SONG_IDS;
  }
  if (
    /\b(actor\s*karthik|karthik\s*actor|navarasa\s*nayagan|navarasanayagan|karthik\s*muthuraman)\b/i.test(qClean) ||
    (qClean.includes("karthik") && /\b(actor|hero|navarasa)\b/i.test(qClean))
  ) {
    return ACTOR_KARTHIK_SONG_IDS;
  }
  if (
    /\b(sad\s*songs?|sogam\s*songs?|soga\s*padalgal?|breakup\s*songs?|break\s*up\s*songs?|heartbreak\s*songs?|feeling\s*sad)\b/i.test(qClean) ||
    qClean === "sad" || qClean === "sogam"
  ) {
    return TAMIL_SAD_SONG_IDS;
  }
  return [];
}

// ════════════════════════════════════════════════════════════════
// ERA / DECADE DETECTION (80s, 90s, 70s, 2000s, etc.)
// ════════════════════════════════════════════════════════════════
export interface DetectedEra {
  era: string; // "80s", "90s", "70s", "60s", "50s", "2000s", "2010s", "2020s"
  startYear: number;
  endYear: number;
}

export function detectEra(query: string): DetectedEra | null {
  const q = query.toLowerCase();
  if (/\b(?:19)?80s\b|\beighties\b|\b198\d\b/i.test(q)) {
    return { era: "80s", startYear: 1980, endYear: 1989 };
  }
  if (/\b(?:19)?90s\b|\bnineties\b|\b199\d\b/i.test(q)) {
    return { era: "90s", startYear: 1990, endYear: 1999 };
  }
  if (/\b(?:19)?70s\b|\bseventies\b|\b197\d\b/i.test(q)) {
    return { era: "70s", startYear: 1970, endYear: 1979 };
  }
  if (/\b(?:19)?60s\b|\bsixties\b|\b196\d\b/i.test(q)) {
    return { era: "60s", startYear: 1960, endYear: 1969 };
  }
  if (/\b(?:19)?50s\b|\bfifties\b|\b195\d\b/i.test(q)) {
    return { era: "50s", startYear: 1950, endYear: 1959 };
  }
  if (/\b(?:2000s|00s)\b|\b200\d\b/i.test(q)) {
    return { era: "2000s", startYear: 2000, endYear: 2009 };
  }
  if (/\b(?:2010s|10s)\b|\b201\d\b/i.test(q)) {
    return { era: "2010s", startYear: 2010, endYear: 2019 };
  }
  if (/\b(?:2020s|20s)\b|\b202\d\b/i.test(q)) {
    return { era: "2020s", startYear: 2020, endYear: 2029 };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// MULTI-QUERY BUILDER
// We fetch from multiple JioSaavn query strings and merge results.
// More raw material → better recall → better ranking output.
// ════════════════════════════════════════════════════════════════
// PHONETIC_CORRECTIONS imported from artistDictionary.ts

export function correctTypos(query: string): string {
  const lower = query.trim().toLowerCase();
  // Exact correction
  if (PHONETIC_CORRECTIONS[lower]) return PHONETIC_CORRECTIONS[lower];
  // Partial: check if any key appears as a word in the query
  for (const [wrong, correct] of Object.entries(PHONETIC_CORRECTIONS)) {
    if (lower.includes(wrong)) {
      return lower.replace(wrong, correct).trim();
    }
  }
  return query;
}

export function buildSearchQueries(
  query: string,
  userLanguages?: string[],
  forcedLang?: string,
): {
  queries: string[];
  knownArtist: string | null;
  detectedMood: string | null;
  detectedEra: DetectedEra | null;
  targetLang: string | null;
} {
  const corrected = correctTypos(query.trim());
  const q = corrected;
  const qLower = q.toLowerCase();

  const queryLang = detectLanguageInQuery(qLower);
  const targetLang = forcedLang || queryLang || (userLanguages && userLanguages[0]) || null;
  const detectedMood = detectMood(qLower);
  const detectedEra = detectEra(qLower);

  const queries: string[] = [q];
  if (corrected.toLowerCase() !== query.trim().toLowerCase()) {
    queries.push(query.trim());
  }

  const effectiveLangs = targetLang
    ? [targetLang]
    : (userLanguages && userLanguages.length > 0
        ? userLanguages.slice(0, 3)
        : ["tamil", "hindi", "telugu"]);

  // ── ACTOR KARTHIK EVERGREEN DISCOVERY ────────────────────────
  const isActorKarthikQuery =
    /\b(actor\s*karthik|karthik\s*actor|navarasa\s*nayagan|navarasanayagan|karthik\s*muthuraman)\b/i.test(qLower) ||
    (qLower.includes("karthik") && /\b(actor|hero|navarasa)\b/i.test(qLower));

  if (isActorKarthikQuery) {
    queries.unshift("karthik tamil actor hits");
    queries.push("Agni Natchathiram songs");
    queries.push("Kizhakku Vaasal songs");
    queries.push("Varusham Padhinaaru songs");
    queries.push("Gopura Vaasalile songs");
    queries.push("Alaigal Oivathillai songs");
    queries.push("Ullathai Alli Thaa songs");
    queries.push("Unnidathil Ennai Koduthen songs");
    queries.push("Mettukudi songs");
    queries.push("Mouna Ragam songs");
  }

  // ── ITEM SONGS / KUTHU DISCOVERY ──────────────────────────────
  const isItemQuery = /\b(items?|item\s*songs?|kuthu\s*songs?|masala\s*songs?)\b/i.test(qLower);
  if (isItemQuery) {
    for (const l of effectiveLangs) {
      queries.push(`${l} item songs`);
      queries.push(`${l} item hits`);
      queries.push(`${l} kuthu songs`);
    }
    queries.push("oo solriya");
    queries.push("kaavaalaa");
    queries.push("appadipodu");
    queries.push("kalasala kalasala");
    queries.push("kattipudi kattipudi da");
    queries.push("pottu thakku");
    queries.push("arabic kuthu");
    queries.push("naa ready");
    queries.push("aaluma doluma");
    queries.push("vaathi coming");
    queries.push("seena thana");
    queries.push("machi open the bottle");
  }

  // ── INDIE / TAMIL ALBUM SONGS DISCOVERY ───────────────────────
  const isIndieAlbumQuery = /\b(album\s*songs?|indie\s*songs?|private\s*songs?)\b/i.test(qLower);
  if (isIndieAlbumQuery) {
    for (const l of effectiveLangs) {
      queries.push(`${l} indie songs`);
      queries.push(`${l} indie hits`);
      queries.push(`think indie ${l}`);
      queries.push(`${l} independent singles`);
      queries.push(`best ${l} album songs`);
    }
    queries.push("katchi sera");
    queries.push("aasa kooda");
    queries.push("enjoy enjaami");
    queries.push("orasaadha");
  }

  // ── ERA-BASED DISCOVERY ───────────────────────────────────────
  // Keep the era in all generated queries so JioSaavn returns decade-relevant tracks
  if (detectedEra) {
    const eraStr = detectedEra.era;
    if (detectedMood) {
      for (const l of effectiveLangs) {
        queries.push(`${l} ${eraStr} ${detectedMood} songs`);
        queries.push(`${eraStr} ${l} ${detectedMood} songs`);
        queries.push(`${l} ${detectedMood} songs ${eraStr}`);
        queries.push(`${l} ${eraStr} hits`);
        queries.push(`${l} ${eraStr} songs`);
        queries.push(`${eraStr} ${l} songs`);
        if (l === "tamil") {
          if (eraStr === "80s") {
            queries.push("80s tamil sad");
            queries.push("tamil 80s hits");
            queries.push("80s tamil songs");
          } else if (eraStr === "90s") {
            queries.push("tamil 90s sad");
            queries.push("90s tamil sad songs");
            queries.push("tamil 90s hits");
            queries.push("90s tamil songs");
          }
        }
      }
      queries.push(`${eraStr} ${detectedMood} songs`);
      queries.push(`${eraStr} songs`);
    } else {
      for (const l of effectiveLangs) {
        queries.push(`${l} ${eraStr} songs`);
        queries.push(`${eraStr} ${l} hits`);
        queries.push(`${l} ${eraStr} hits`);
        if (l === "tamil") {
          if (eraStr === "80s") {
            queries.push("tamil 80s hits");
            queries.push("80s tamil songs");
          } else if (eraStr === "90s") {
            queries.push("tamil 90s hits");
            queries.push("90s tamil songs");
          }
        }
      }
      queries.push(`${eraStr} songs`);
      queries.push(`${eraStr} hits`);
    }
  } else if (detectedMood) {
    // Standard mood-based queries when no era specified
    const mainLang = targetLang || (effectiveLangs && effectiveLangs[0]) || "tamil";
    // If the user's raw query didn't specify a language, place language-specific mood queries FIRST
    // so JioSaavn never runs raw English mood words that produce Bhojpuri/Punjabi false positives
    if (!queryLang && mainLang) {
      queries.unshift(`${mainLang} ${detectedMood} songs`);
      queries.unshift(`${mainLang} ${detectedMood} hits`);
    }

    for (const l of effectiveLangs) {
      queries.push(`${l} ${detectedMood} songs`);
      queries.push(`${detectedMood} songs ${l}`);
      queries.push(`${l} ${detectedMood} hits`);
      queries.push(`best ${l} ${detectedMood} songs`);
      if (l === "tamil" && detectedMood === "sad") {
        queries.push("tamil sogam padalgal");
        queries.push("tamil breakup songs");
        queries.push("tamil feeling sad");
        queries.push("kanave kanave");
        queries.push("poove sempoove");
        queries.push("pona pogattum");
        queries.push("kanne kalaimane");
        queries.push("amma endru azhaikkatha");
        queries.push("en kadhal solla");
        queries.push("nenjukkul peidhidum");
      }
    }
    queries.push(`${detectedMood} songs`);
    queries.push(`${detectedMood} hits`);
  }

  // ── KNOWN SONG: inject artist name ───────────────────────────
  const knownArtist = getKnownArtist(qLower);
  if (
    knownArtist &&
    !qLower.includes(knownArtist.toLowerCase().split(" ")[0])
  ) {
    queries.push(`${q} ${knownArtist}`);
  }

  // ── Short queries: artist/song discovery ─────────────────────
  const wordCount = q.split(/\s+/).length;
  if (wordCount <= 2 && !knownArtist && !detectedMood && !detectedEra && !isIndieAlbumQuery) {
    queries.push(`${q} songs`);
    queries.push(`${q} hits`);
    if (targetLang) {
      queries.push(`${q} ${targetLang}`);
    }
  }

  return { queries, knownArtist, detectedMood, detectedEra, targetLang };
}

// ════════════════════════════════════════════════════════════════
// NEW EXPORTS — used by the rewritten search route
// Uses the same canonical Song type from jiosaavn.ts
// ════════════════════════════════════════════════════════════════

// Generic rank that works with any object that has the RankedSong fields.
// Unified entry-point for the search route.
export function rankSongs<T extends RankedSong>(
  songs: T[],
  query: string,
  preferLang?: string,
  knownArtist?: string,
  userContext?: UserPersonalizationContext,
  detectedMood?: string | null,
  detectedEra?: DetectedEra | null,
  pinnedIds?: Set<string>,
): T[] {
  return rankSearchResults(songs, query, preferLang, knownArtist, userContext, detectedMood, detectedEra, pinnedIds) as T[];
}

// Deduplicate wrapper (alias with cleaner name)
export function dedupSongs<T extends RankedSong>(songs: T[]): T[] {
  return deduplicateResults(songs) as T[];
}
