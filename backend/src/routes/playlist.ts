import { Router, Response } from "express";
import mongoose from "mongoose";
import { Playlist } from "../models/Playlist.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { softAuth, SoftAuthRequest } from "../middleware/softAuth.js";
import { TAMIL_ITEM_SONG_IDS, ACTOR_KARTHIK_SONG_IDS, TAMIL_SAD_SONG_IDS } from "../services/searchRanker.js";
import { fetchSongsByIds, getPlaylistDetails } from "../services/jiosaavn.js";

const router = Router();

function formatPlaylistSong(s: any) {
  const songId = String(s.id || s.songId || "");
  const title = String(s.name || s.title || "");
  const artist = String(s.primaryArtists || s.artist || "");
  let albumArt = "";
  if (typeof s.image === "string") {
    albumArt = s.image;
  } else if (Array.isArray(s.image) && s.image.length > 0) {
    albumArt = s.image[s.image.length - 1]?.url || s.image[0]?.url || "";
  } else if (s.albumArt) {
    albumArt = s.albumArt;
  }
  const duration = Number(s.duration) || 0;
  const downloadUrl = Array.isArray(s.downloadUrl)
    ? s.downloadUrl.map((d: any) => ({ quality: d.quality || "320kbps", url: d.url || d.link || "" }))
    : Array.isArray(s.download_url)
    ? s.download_url.map((d: any) => ({ quality: d.quality || "320kbps", url: d.link || d.url || "" }))
    : [];

  return {
    ...s,
    id: songId,
    songId,
    name: title,
    title,
    primaryArtists: artist,
    artist,
    image: albumArt,
    albumArt,
    duration,
    downloadUrl,
    download_url: downloadUrl,
  };
}

// GET /api/playlists — All user playlists (without songs for speed)
router.get("/", softAuth, async (req: SoftAuthRequest, res: Response): Promise<void> => {
  try {
    const featuredPlaylists = [
      {
        _id: "tamil-sad-songs",
        name: "Tamil Heartbreak & Soulful Sad Melodies",
        description: "Deeply emotional Tamil heartbreak songs, soul-stirring melodies & all-time melancholy masterpieces.",
        coverImage: "https://c.saavncdn.com/editorial/charts_TamilRomanticHits_186358_20240408062031_500x500.jpg",
        isPublic: true,
        songCount: TAMIL_SAD_SONG_IDS.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        _id: "actor-karthik-hits",
        name: "Navarasa Nayagan Karthik All-Time Blockbuster Hits",
        description: "Timeless romantic, melody and mass evergreen hits of Actor Karthik from Agni Natchathiram, Mouna Ragam, Kizhakku Vaasal & more.",
        coverImage: "https://c.saavncdn.com/editorial/charts_Tamil1990s_190250_20240408062124_500x500.jpg",
        isPublic: true,
        songCount: ACTOR_KARTHIK_SONG_IDS.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        _id: "tamil-item-songs",
        name: "Tamil Item & Kuthu All-Time Hits",
        description: "The ultimate collection of iconic Kollywood item numbers, kuthu beats & dance bangers.",
        coverImage: "https://c.saavncdn.com/editorial/charts_Tamil1990s_190250_20240408062124_500x500.jpg",
        isPublic: true,
        songCount: TAMIL_ITEM_SONG_IDS.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    if (!req.userId) {
      res.json({ playlists: featuredPlaylists });
      return;
    }
    const playlists = await Playlist.find({ userId: req.userId })
      .select("-songs")
      .sort({ updatedAt: -1 });
    res.json({ playlists: [...featuredPlaylists, ...playlists] });
  } catch (err) {
    console.error("[Playlist] List error:", err);
    res.status(500).json({ error: "Failed to fetch playlists" });
  }
});

// POST /api/playlists — Create
router.post("/", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, isPublic, isAIGenerated, songs, tags } =
      req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: "Playlist name required" });
      return;
    }

    const playlist = await Playlist.create({
      userId: req.userId,
      name: name.trim(),
      description: description || "",
      isPublic: isPublic || false,
      isAIGenerated: isAIGenerated || false,
      songs: songs || [],
      tags: tags || [],
    });

    res.status(201).json({ playlist });
  } catch (err) {
    console.error("[Playlist] Create error:", err);
    res.status(500).json({ error: "Failed to create playlist" });
  }
});

// GET /api/playlists/:id — Single playlist with all songs
router.get("/:id", softAuth, async (req: SoftAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (id === "tamil-sad-songs" || id === "tamil-sad-hits" || id === "sad-songs") {
      const songs = await fetchSongsByIds(TAMIL_SAD_SONG_IDS);
      res.json({
        playlist: {
          _id: "tamil-sad-songs",
          name: "Tamil Heartbreak & Soulful Sad Melodies",
          description: "Deeply emotional Tamil heartbreak songs, soul-stirring melodies & all-time melancholy masterpieces.",
          coverImage: "https://c.saavncdn.com/editorial/charts_TamilRomanticHits_186358_20240408062031_500x500.jpg",
          userId: "hearttone-official",
          isAIGenerated: false,
          isPublic: true,
          songs: songs.map(formatPlaylistSong),
        },
      });
      return;
    }

    if (id === "actor-karthik-hits" || id === "karthik-hits" || id === "navarasa-nayagan-karthik") {
      const songs = await fetchSongsByIds(ACTOR_KARTHIK_SONG_IDS);
      res.json({
        playlist: {
          _id: "actor-karthik-hits",
          name: "Navarasa Nayagan Karthik All-Time Blockbuster Hits",
          description: "Timeless romantic, melody and mass evergreen hits of Actor Karthik from Agni Natchathiram, Mouna Ragam, Kizhakku Vaasal & more.",
          coverImage: "https://c.saavncdn.com/editorial/charts_Tamil1990s_190250_20240408062124_500x500.jpg",
          userId: "hearttone-official",
          isAIGenerated: false,
          isPublic: true,
          songs: songs.map(formatPlaylistSong),
        },
      });
      return;
    }

    if (id === "tamil-item-songs" || id === "tamil-item-hits" || id === "item-songs") {
      const songs = await fetchSongsByIds(TAMIL_ITEM_SONG_IDS);
      res.json({
        playlist: {
          _id: "tamil-item-songs",
          name: "Tamil Item & Kuthu All-Time Hits",
          description: "The ultimate collection of iconic Kollywood item numbers, kuthu beats & dance bangers.",
          coverImage: "https://c.saavncdn.com/editorial/charts_Tamil1990s_190250_20240408062124_500x500.jpg",
          userId: "hearttone-official",
          isAIGenerated: false,
          isPublic: true,
          songs: songs.map(formatPlaylistSong),
        },
      });
      return;
    }

    // 1. Try finding in MongoDB (user-created playlists)
    let playlist: any = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      playlist = await Playlist.findById(id);
    }

    if (playlist) {
      res.json({ playlist });
      return;
    }

    // 2. Try fetching from JioSaavn (external search/featured playlists like 810634923)
    try {
      const ext = await getPlaylistDetails(id);
      if (ext && (ext.songs || ext.name || ext.title)) {
        const rawSongs = ext.songs || [];
        const coverImg = Array.isArray(ext.image)
          ? ext.image[ext.image.length - 1]?.url || ext.image[0]?.url || ""
          : ext.image || null;

        res.json({
          playlist: {
            _id: ext.id || id,
            id: ext.id || id,
            name: ext.name || ext.title || "Featured Playlist",
            description: ext.description || ext.subtitle || "",
            coverImage: coverImg,
            userId: "jiosaavn-official",
            isAIGenerated: false,
            isPublic: true,
            songCount: rawSongs.length,
            songs: rawSongs.map(formatPlaylistSong),
          },
        });
        return;
      }
    } catch (extErr) {
      console.warn("[Playlist] Failed to fetch external JioSaavn playlist:", extErr);
    }

    res.status(404).json({ error: "Playlist not found" });
  } catch (err) {
    console.error("[Playlist] Get error:", err);
    res.status(500).json({ error: "Failed to fetch playlist" });
  }
});

// PATCH /api/playlists/:id — Update name/desc/public
router.patch("/:id", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const playlist = await Playlist.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }

    const { name, description, isPublic } = req.body;
    if (name !== undefined) playlist.name = name.trim();
    if (description !== undefined) playlist.description = description;
    if (isPublic !== undefined) playlist.isPublic = isPublic;

    await playlist.save();
    res.json({ playlist });
  } catch (err) {
    console.error("[Playlist] Update error:", err);
    res.status(500).json({ error: "Failed to update playlist" });
  }
});

// DELETE /api/playlists/:id
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await Playlist.deleteOne({
        _id: req.params.id,
        userId: req.userId,
      });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: "Playlist not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[Playlist] Delete error:", err);
      res.status(500).json({ error: "Failed to delete playlist" });
    }
  },
);

// POST /api/playlists/:id/songs — Add song
router.post(
  "/:id/songs",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const playlist = await Playlist.findOne({
        _id: req.params.id,
        userId: req.userId,
      });
      if (!playlist) {
        res.status(404).json({ error: "Playlist not found" });
        return;
      }

      const { song } = req.body;
      if (!song || !song.songId) {
        res.status(400).json({ error: "Song data required" });
        return;
      }

      // Avoid duplicates
      const exists = playlist.songs.some((s) => s.songId === song.songId);
      if (exists) {
        res.status(409).json({ error: "Song already in playlist" });
        return;
      }

      playlist.songs.push(song);
      await playlist.save();
      res.json({ playlist });
    } catch (err) {
      console.error("[Playlist] Add song error:", err);
      res.status(500).json({ error: "Failed to add song" });
    }
  },
);

// DELETE /api/playlists/:id/songs/:songId — Remove song
router.delete(
  "/:id/songs/:songId",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const playlist = await Playlist.findOne({
        _id: req.params.id,
        userId: req.userId,
      });
      if (!playlist) {
        res.status(404).json({ error: "Playlist not found" });
        return;
      }

      playlist.songs = playlist.songs.filter(
        (s) => s.songId !== req.params.songId,
      );
      await playlist.save();
      res.json({ playlist });
    } catch (err) {
      console.error("[Playlist] Remove song error:", err);
      res.status(500).json({ error: "Failed to remove song" });
    }
  },
);

// PATCH /api/playlists/:id/reorder — Reorder songs
router.patch(
  "/:id/reorder",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const playlist = await Playlist.findOne({
        _id: req.params.id,
        userId: req.userId,
      });
      if (!playlist) {
        res.status(404).json({ error: "Playlist not found" });
        return;
      }

      const { songIds } = req.body;
      if (!Array.isArray(songIds)) {
        res.status(400).json({ error: "songIds array required" });
        return;
      }

      // Reorder based on songIds order
      const songMap = new Map(playlist.songs.map((s) => [s.songId, s]));
      const reordered = songIds
        .map((id: string) => songMap.get(id))
        .filter(Boolean);
      playlist.songs = reordered as any;
      await playlist.save();
      res.json({ playlist });
    } catch (err) {
      console.error("[Playlist] Reorder error:", err);
      res.status(500).json({ error: "Failed to reorder" });
    }
  },
);

export default router;
