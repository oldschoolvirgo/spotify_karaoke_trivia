// ============================================================
// SYHO MUSIC TRIVIA
// TriviaAdmin - Milestones 1-6
//
// FULL PLAYLIST TEST:
//
// Playlist entries: 141
// Unique recordings: 139
// Unique artists: 97
//
// Broken recording references: 0
// Broken artist references: 0
// Recording key mismatches: 0
// Artist key mismatches: 0
// Missing durations: 0
// Missing titles: 0
// Missing artists: 0
//
// Spotify observations during full test:
//
// Stand and Deliver:
//   metadata.hasLyrics = true
//   lyrics endpoint currently fails
//   Spotify UI says lyrics are still being worked on.
//
// Duran Duran:
//   biography request initially failed
//   retry succeeded.
//
// Known-working Milestones 1-6 baseline.
// ============================================================

globalThis.TriviaAdmin = (() => {
    "use strict";

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const DEFAULT_CONFIG = {
        workerUrl: "http://localhost:8787/api/ai",

        metadataHost:
            "https://spclient.wg.spotify.com/metadata/4",

        metadataConcurrency: 3,
        metadataDelayMs: 150,

        // Lyrics proved more sensitive to rate limiting.
        lyricsConcurrency: 1,
        lyricsDelayMs: 2000,

        artistDelayMs: 1000,

        candidateCount: 5,
        playbackDurationMs: 30000
    };

    const QUESTION_TYPES = [
        "lyric",
        "song_title",
        "artist_identification",
        "artist_fact",
        "collaboration"
    ];

    const QUESTION_DIFFICULTIES = [
        "easy",
        "medium",
        "hard"
    ];

    const SOURCE_FACT_TYPES = [
        "lyric",
        "recording_title",
        "recording_artist",
        "artist_role",
        "artist_biography"
    ];


    // ============================================================
    // STATE
    // ============================================================

    const state = {
        workingSource: null,
        schema: null,
        lastGeneration: null
    };


    // ============================================================
    // GENERAL HELPERS
    // ============================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function spotifyImageToHttps(uri) {
        const prefix = "spotify:image:";

        if (!uri) {
            return null;
        }

        return uri.startsWith(prefix)
            ? `https://i.scdn.co/image/${uri.slice(prefix.length)}`
            : uri;
    }


    function getAlbumImage(album) {
        const images = album?.images ?? [];

        return (
            images.find(image => image?.label === "large") ??
            images.find(image => image?.label === "xlarge") ??
            images.find(image => image?.label === "standard") ??
            images[0] ??
            null
        );
    }


    function requireSchema() {
        if (!state.schema) {
            throw new Error(
                "No Trivia Schema V2 is loaded. Run TriviaAdmin.importPlaylist() first."
            );
        }

        return state.schema;
    }


    // ============================================================
    // PLAYLIST NORMALIZATION
    // ============================================================

    function normalizePlaylist(
        playlist,
        requestedPlaylistUri
    ) {
        const tracks =
            (playlist?.contents?.items ?? [])
                .filter(item =>
                    item?.type === "track" &&
                    item?.uri &&
                    !item?.isLocal &&
                    item?.isPlayable !== false
                )
                .map((item, index) => {
                    const albumImage =
                        getAlbumImage(item.album);

                    return {
                        playlistPosition:
                            index + 1,

                        spotifyUri:
                            item.uri,

                        trackName:
                            item.name ?? null,

                        artists:
                            (item.artists ?? [])
                                .map(artist => ({
                                    spotifyUri:
                                        artist.uri ?? null,

                                    name:
                                        artist.name ?? null
                                })),

                        album: {
                            spotifyUri:
                                item.album?.uri ?? null,

                            name:
                                item.album?.name ?? null,

                            imageUri:
                                albumImage?.url ?? null,

                            imageUrl:
                                spotifyImageToHttps(
                                    albumImage?.url
                                )
                        },

                        discNumber:
                            item.discNumber ?? null,

                        trackNumber:
                            item.trackNumber ?? null,

                        durationMs:
                            item.duration?.milliseconds ?? null,

                        explicit:
                            item.isExplicit === true
                    };
                });

        return {
            schemaVersion: 1,

            source: {
                type: "spotify_playlist",

                playlistUri:
                    playlist?.metadata?.uri ??
                    requestedPlaylistUri,

                playlistName:
                    playlist?.metadata?.name ?? null,

                description:
                    playlist?.metadata?.description ?? null
            },

            extractedAt:
                new Date().toISOString(),

            trackCount:
                tracks.length,

            tracks
        };
    }


    async function extractPlaylist(
        playlistUri,
        limit = null
    ) {
        console.log(
            "Fetching Spotify playlist..."
        );

        const playlist =
            await Spicetify.Platform.PlaylistAPI
                .getPlaylist(playlistUri);

        const normalized =
            normalizePlaylist(
                playlist,
                playlistUri
            );

        const originalTrackCount =
            normalized.tracks.length;

        if (
            Number.isInteger(limit) &&
            limit > 0
        ) {
            normalized.tracks =
                normalized.tracks.slice(
                    0,
                    limit
                );

            normalized.trackCount =
                normalized.tracks.length;

            normalized.source.originalPlaylistTrackCount =
                originalTrackCount;

            normalized.source.importLimit =
                limit;

            console.log(
                `Smoke-test limit applied: ${normalized.trackCount}/${originalTrackCount} tracks`
            );
        } else {
            console.log(
                `Playlist contains ${normalized.trackCount} usable tracks.`
            );
        }

        return normalized;
    }


    // ============================================================
    // TRACK METADATA
    // ============================================================

    async function getTrackMetadata(
        spotifyUri
    ) {
        const id =
            Spicetify.URI
                .from(spotifyUri)
                .id;

        const hexId =
            Spicetify.URI.idToHex(id);

        const response =
            await Spicetify.Platform
                .RequestBuilder
                .build()
                .withHost(
                    DEFAULT_CONFIG.metadataHost
                )
                .withPath(
                    `/track/${hexId}`
                )
                .send();

        return await response.body;
    }


    function normalizeTrackMetadata(data) {
        if (!data) {
            return null;
        }

        const isrc =
            data.external_id
                ?.find(
                    item =>
                        item?.type
                            ?.toLowerCase() ===
                        "isrc"
                )
                ?.id ?? null;

        return {
            canonicalUri:
                data.canonical_uri ?? null,

            isrc,

            popularity:
                data.popularity ?? null,

            albumType:
                data.album?.type ?? null,

            label:
                data.album?.label ?? null,

            releaseDate: {
                year:
                    data.album?.date?.year ?? null,

                month:
                    data.album?.date?.month ?? null,

                day:
                    data.album?.date?.day ?? null
            },

            hasLyrics:
                data.has_lyrics === true,

            languages:
                data.language_of_performance ?? [],

            originalTitle:
                data.original_title ?? null,

            artistRoles:
                (data.artist_with_role ?? [])
                    .map(artist => ({
                        name:
                            artist.artist_name ?? null,

                        role:
                            artist.role ?? null
                    }))
        };
    }


    async function enrichAllTrackMetadata(
        source,
        {
            concurrency =
                DEFAULT_CONFIG.metadataConcurrency,

            delayMs =
                DEFAULT_CONFIG.metadataDelayMs
        } = {}
    ) {
        const tracks =
            source.tracks ?? [];

        let nextIndex = 0;
        let completed = 0;
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        console.log(
            `Starting metadata enrichment for ${tracks.length} tracks...`
        );

        async function worker() {
            while (true) {
                const index =
                    nextIndex++;

                if (index >= tracks.length) {
                    return;
                }

                const track =
                    tracks[index];

                // Resume support.
                if (
                    track.metadata &&
                    !track.metadataError
                ) {
                    skipped++;
                    completed++;

                    console.log(
                        `[${index + 1}/${tracks.length}] ↷ ${track.trackName} — metadata already processed`
                    );

                    continue;
                }

                try {
                    const rawMetadata =
                        await getTrackMetadata(
                            track.spotifyUri
                        );

                    track.metadata =
                        normalizeTrackMetadata(
                            rawMetadata
                        );

                    delete track.metadataError;

                    succeeded++;

                    console.log(
                        `[${index + 1}/${tracks.length}] ✓ ${track.trackName}`
                    );
                } catch (error) {
                    failed++;

                    track.metadata = null;

                    track.metadataError = {
                        message:
                            error?.message ??
                            String(error)
                    };

                    console.error(
                        `[${index + 1}/${tracks.length}] ✗ ${track.trackName}`,
                        error
                    );
                }

                completed++;

                if (delayMs > 0) {
                    await sleep(delayMs);
                }
            }
        }

        const workerCount =
            Math.min(
                Math.max(
                    1,
                    concurrency
                ),
                tracks.length || 1
            );

        await Promise.all(
            Array.from(
                {
                    length:
                        workerCount
                },
                () => worker()
            )
        );

        console.log(
            "Metadata enrichment complete."
        );

        console.log({
            completed,
            succeeded,
            failed,
            skipped
        });

        return source;
    }


    // ============================================================
    // RECORDING IDENTITY / DEDUPLICATION
    // ============================================================

    function addRecordingKeys(source) {
        for (
            const track
            of source.tracks ?? []
        ) {
            track.recordingKey =
                track.metadata?.isrc ??
                track.metadata?.canonicalUri ??
                track.spotifyUri;
        }

        return source;
    }


    function buildRecordings(source) {
        const recordings = {};

        for (
            const track
            of source.tracks ?? []
        ) {
            const recordingKey =
                track.recordingKey;

            if (!recordingKey) {
                console.warn(
                    "Track has no recordingKey:",
                    track.trackName
                );

                continue;
            }

            if (!recordings[recordingKey]) {
                recordings[recordingKey] = {
                    recordingKey,

                    spotifyUri:
                        track.spotifyUri,

                    canonicalUri:
                        track.metadata?.canonicalUri ??
                        null,

                    isrc:
                        track.metadata?.isrc ??
                        null,

                    trackName:
                        track.trackName,

                    artists:
                        track.artists,

                    album:
                        track.album,

                    metadata:
                        track.metadata,

                    playlistOccurrences:
                        []
                };
            }

            recordings[
                recordingKey
            ].playlistOccurrences.push({
                playlistPosition:
                    track.playlistPosition,

                spotifyUri:
                    track.spotifyUri,

                albumUri:
                    track.album?.spotifyUri ??
                    null,

                albumName:
                    track.album?.name ??
                    null
            });
        }

        source.recordings =
            recordings;

        console.log(
            `Built ${Object.keys(recordings).length} unique recordings from ${source.tracks.length} playlist entries.`
        );

        return source;
    }


    // ============================================================
    // LYRICS
    // ============================================================

    async function getTrackLyrics(
        spotifyUri,
        spotifyImageUri
    ) {
        if (!spotifyImageUri) {
            throw new Error(
                "Spotify image URI is required for the lyrics endpoint."
            );
        }

        const trackId =
            Spicetify.URI
                .from(spotifyUri)
                .id;

        const response =
            await Spicetify.Platform
                .RequestBuilder
                .build()
                .withHost(
                    "https://spclient.wg.spotify.com"
                )
                .withPath(
                    `/color-lyrics/v2/track/${trackId}` +
                    `/image/${encodeURIComponent(spotifyImageUri)}` +
                    `?format=json&vocalRemoval=false&market=from_token`
                )
                .send();

        return await response.body;
    }


    function normalizeLyrics(data) {
        const lyrics =
            data?.lyrics;

        if (!lyrics) {
            return null;
        }

        return {
            syncType:
                lyrics.syncType ?? null,

            language:
                lyrics.language ?? null,

            provider:
                lyrics.provider ?? null,

            providerLyricsId:
                lyrics.providerLyricsId ?? null,

            lines:
                (lyrics.lines ?? [])
                    .filter(
                        line =>
                            line?.words?.trim()
                    )
                    .map(line => ({
                        startTimeMs:
                            Number(
                                line.startTimeMs
                            ),

                        words:
                            line.words
                    }))
        };
    }


    async function enrichAllRecordingLyrics(
    source,
    {
        concurrency =
            DEFAULT_CONFIG.lyricsConcurrency,

        delayMs =
            DEFAULT_CONFIG.lyricsDelayMs
    } = {}
) {
    const recordings =
        Object.values(
            source.recordings ?? {}
        );

    let nextIndex = 0;
    let completed = 0;
    let succeeded = 0;
    let unavailable = 0;
    let pending = 0;
    let failed = 0;
    let skipped = 0;

    console.log(
        `Starting lyrics enrichment for ${recordings.length} recordings...`
    );

    async function worker() {
        while (true) {
            const index =
                nextIndex++;

            if (index >= recordings.length) {
                return;
            }

            const recording =
                recordings[index];

            // Resume support.
            //
            // available:
            //   We already successfully retrieved lyrics.
            //
            // unavailable:
            //   Spotify metadata explicitly says this recording
            //   does not have lyrics.
            //
            // pending is intentionally NOT skipped so a future
            // enrichment run can retry it.
            if (
                recording.lyricsStatus === "available" ||
                recording.lyricsStatus === "unavailable"
            ) {
                skipped++;
                completed++;

                console.log(
                    `[${index + 1}/${recordings.length}] ↷ ${recording.trackName} — lyrics already processed`
                );

                continue;
            }

            try {
                // Spotify explicitly says this recording
                // does not have lyrics.
                if (
                    recording.metadata?.hasLyrics !== true
                ) {
                    recording.lyrics =
                        null;

                    recording.lyricsStatus =
                        "unavailable";

                    delete recording.lyricsError;

                    unavailable++;

                    console.log(
                        `[${index + 1}/${recordings.length}] ○ ${recording.trackName} — no lyrics`
                    );
                } else {
                    // Spotify metadata says lyrics exist.
                    // Attempt to retrieve them.
                    const rawLyrics =
                        await getTrackLyrics(
                            recording.spotifyUri,
                            recording.album?.imageUri
                        );

                    const normalizedLyrics =
                        normalizeLyrics(
                            rawLyrics
                        );

                    if (normalizedLyrics) {
                        recording.lyrics =
                            normalizedLyrics;

                        recording.lyricsStatus =
                            "available";

                        delete recording.lyricsError;

                        succeeded++;

                        console.log(
                            `[${index + 1}/${recordings.length}] ✓ ${recording.trackName}`
                        );
                    } else {
                        // Spotify says lyrics exist, but the
                        // endpoint did not provide usable lyrics.
                        //
                        // Treat this as pending rather than
                        // unavailable/error because Spotify may
                        // still be preparing the lyrics.
                        recording.lyrics =
                            null;

                        recording.lyricsStatus =
                            "pending";

                        recording.lyricsError = {
                            message:
                                "Spotify metadata reports lyrics, but the lyrics endpoint returned no usable lyrics."
                        };

                        pending++;

                        console.warn(
                            `[${index + 1}/${recordings.length}] ◌ ${recording.trackName} — lyrics pending`
                        );
                    }
                }
            } catch (error) {
                // A thrown request error is a technical failure.
                //
                // Do NOT infer "pending" merely because Spotify metadata
                // reports hasLyrics=true. The request may have failed due
                // to rate limiting, networking, server errors, etc.
                //
                // "pending" is reserved for cases where the request itself
                // succeeds but Spotify does not return usable lyrics.

                recording.lyrics =
                    null;

                recording.lyricsStatus =
                    "error";

                recording.lyricsError = {
                    message:
                        error?.message ||
                        String(error) ||
                        "Lyrics request failed."
                };

                failed++;

                console.error(
                    `[${index + 1}/${recordings.length}] ✗ ${recording.trackName} — lyrics request failed`,
                    error
                );
            }

            completed++;

            if (
                delayMs > 0 &&
                index < recordings.length - 1
            ) {
                await sleep(delayMs);
            }
        }
    }

    const workerCount =
        Math.min(
            Math.max(
                1,
                concurrency
            ),
            recordings.length || 1
        );

    await Promise.all(
        Array.from(
            {
                length:
                    workerCount
            },
            () => worker()
        )
    );

    console.log(
        "Lyrics enrichment complete."
    );

    console.log({
        completed,
        succeeded,
        unavailable,
        pending,
        failed,
        skipped
    });

    return source;
}


    // ============================================================
    // ARTISTS
    // ============================================================

    function buildArtists(source) {
        const artists = {};

        for (
            const recording
            of Object.values(
                source.recordings ?? {}
            )
        ) {
            for (
                const artist
                of recording.artists ?? []
            ) {
                if (!artist?.spotifyUri) {
                    continue;
                }

                const artistUri =
                    artist.spotifyUri;

                if (!artists[artistUri]) {
                    artists[artistUri] = {
                        spotifyUri:
                            artistUri,

                        name:
                            artist.name ?? null,

                        recordingKeys:
                            [],

                        playlistOccurrences:
                            []
                    };
                }

                if (
                    !artists[
                        artistUri
                    ].recordingKeys.includes(
                        recording.recordingKey
                    )
                ) {
                    artists[
                        artistUri
                    ].recordingKeys.push(
                        recording.recordingKey
                    );
                }

                for (
                    const occurrence
                    of recording.playlistOccurrences ?? []
                ) {
                    artists[
                        artistUri
                    ].playlistOccurrences.push({
                        playlistPosition:
                            occurrence.playlistPosition,

                        recordingKey:
                            recording.recordingKey,

                        spotifyUri:
                            occurrence.spotifyUri,

                        trackName:
                            recording.trackName
                    });
                }
            }
        }

        source.artists =
            artists;

        console.log(
            `Built artist cache containing ${Object.keys(artists).length} unique artists.`
        );

        return source;
    }


    function normalizeArtistOverview(
        response
    ) {
        const artist =
            response?.data?.artistUnion;

        if (!artist) {
            return null;
        }

        return {
            biography:
                artist.profile?.biography?.text ??
                null
        };
    }


    async function enrichAllArtists(
        source,
        delayMs =
            DEFAULT_CONFIG.artistDelayMs
    ) {
        const artists =
            Object.values(
                source.artists ?? {}
            );

        console.log(
            `Starting artist enrichment for ${artists.length} artists...`
        );

        let available = 0;
        let unavailable = 0;
        let errors = 0;
        let skipped = 0;

        for (
            let index = 0;
            index < artists.length;
            index++
        ) {
            const artist =
                artists[index];

            if (
                artist.artistOverviewStatus === "available" ||
                artist.artistOverviewStatus === "unavailable"
            ) {
                skipped++;

                console.log(
                    `[${index + 1}/${artists.length}] ↷ ${artist.name} — already processed`
                );

                continue;
            }

            try {
                const response =
                    await Spicetify.GraphQL.Request(
                        Spicetify.GraphQL.Definitions
                            .queryArtistOverview,

                        {
                            uri:
                                artist.spotifyUri,

                            locale: "",

                            preReleaseV2:
                                true
                        }
                    );

                const normalized =
                    normalizeArtistOverview(
                        response
                    );

                if (
                    normalized?.biography
                ) {
                    artist.artistOverview =
                        normalized;

                    artist.artistOverviewStatus =
                        "available";

                    delete artist.artistOverviewError;

                    available++;

                    console.log(
                        `[${index + 1}/${artists.length}] ✓ ${artist.name}`
                    );
                } else {
                    artist.artistOverview =
                        null;

                    artist.artistOverviewStatus =
                        "unavailable";

                    delete artist.artistOverviewError;

                    unavailable++;

                    console.log(
                        `[${index + 1}/${artists.length}] ○ ${artist.name} — biography unavailable`
                    );
                }
            } catch (error) {
                artist.artistOverviewStatus =
                    "error";

                artist.artistOverviewError = {
                    message:
                        error?.message ??
                        String(error)
                };

                errors++;

                console.error(
                    `[${index + 1}/${artists.length}] ✗ ${artist.name}`,
                    error
                );
            }

            if (
                delayMs > 0 &&
                index < artists.length - 1
            ) {
                await sleep(delayMs);
            }
        }

        console.log(
            "Artist enrichment complete."
        );

        console.log({
            available,
            unavailable,
            errors,
            skipped
        });

        return source;
    }


    // ============================================================
    // SCHEMA V2
    // ============================================================

    function createTriviaV2Skeleton(
        source
    ) {
        return {
            schemaVersion: 2,

            source: {
                type:
                    source.source?.type ??
                    "spotify_playlist",

                playlistUri:
                    source.source?.playlistUri ??
                    null,

                playlistName:
                    source.source?.playlistName ??
                    null,

                description:
                    source.source?.description ??
                    null,

                importedAt:
                    source.extractedAt ??
                    null,

                entries: []
            },

            recordings: {},
            artists: {},

            stats: {
                playlistEntries: 0,
                uniqueRecordings: 0,
                uniqueArtists: 0,

            lyrics: {
                available: 0,
                unavailable: 0,
                pending: 0,
                error: 0
            },

                artistBiographies: {
                    available: 0,
                    unavailable: 0,
                    error: 0
                }
            }
        };
    }


    function buildV2PlaylistEntries(
        source,
        target
    ) {
        target.source.entries =
            (source.tracks ?? [])
                .map(track => ({
                    position:
                        track.playlistPosition,

                    spotifyUri:
                        track.spotifyUri,

                    recordingKey:
                        track.recordingKey
                }));

        target.stats.playlistEntries =
            target.source.entries.length;

        return target;
    }


    function getSourceTrackForRecording(
        source,
        recording
    ) {
        return (
            (source.tracks ?? [])
                .find(
                    track =>
                        track.spotifyUri ===
                        recording.spotifyUri
                ) ??

            (source.tracks ?? [])
                .find(
                    track =>
                        track.recordingKey ===
                        recording.recordingKey
                ) ??

            null
        );
    }


    function buildV2Recordings(
        source,
        target
    ) {
        const recordings = {};

        for (
            const recording
            of Object.values(
                source.recordings ?? {}
            )
        ) {
            const key =
                recording.recordingKey;

            if (!key) {
                console.warn(
                    "Skipping recording without recordingKey:",
                    recording
                );

                continue;
            }

            const sourceTrack =
                getSourceTrackForRecording(
                    source,
                    recording
                );

            recordings[key] = {
                recordingKey:
                    key,

                spotifyUri:
                    recording.spotifyUri ??
                    null,

                canonicalUri:
                    recording.canonicalUri ??
                    recording.metadata?.canonicalUri ??
                    null,

                isrc:
                    recording.isrc ??
                    recording.metadata?.isrc ??
                    null,

                title:
                    recording.trackName ??
                    sourceTrack?.trackName ??
                    null,

                artists:
                    (
                        recording.artists ??
                        sourceTrack?.artists ??
                        []
                    ).map(
                        artist => ({
                            spotifyUri:
                                artist.spotifyUri ??
                                null,

                            name:
                                artist.name ??
                                null
                        })
                    ),

                album: {
                    spotifyUri:
                        recording.album?.spotifyUri ??
                        sourceTrack?.album?.spotifyUri ??
                        null,

                    name:
                        recording.album?.name ??
                        sourceTrack?.album?.name ??
                        null,

                    imageUri:
                        recording.album?.imageUri ??
                        sourceTrack?.album?.imageUri ??
                        null,

                    imageUrl:
                        recording.album?.imageUrl ??
                        sourceTrack?.album?.imageUrl ??
                        null
                },

                durationMs:
                    sourceTrack?.durationMs ??
                    null,

                explicit:
                    sourceTrack?.explicit ===
                    true,

                metadata: {
                    popularity:
                        recording.metadata?.popularity ??
                        null,

                    albumType:
                        recording.metadata?.albumType ??
                        null,

                    label:
                        recording.metadata?.label ??
                        null,

                    releaseDate: {
                        year:
                            recording.metadata
                                ?.releaseDate?.year ??
                            null,

                        month:
                            recording.metadata
                                ?.releaseDate?.month ??
                            null,

                        day:
                            recording.metadata
                                ?.releaseDate?.day ??
                            null
                    },

                    hasLyrics:
                        recording.metadata?.hasLyrics ===
                        true,

                    languages:
                        recording.metadata?.languages ??
                        [],

                    originalTitle:
                        recording.metadata?.originalTitle ??
                        null,

                    artistRoles:
                        (
                            recording.metadata?.artistRoles ??
                            []
                        ).map(
                            artist => ({
                                name:
                                    artist.name ??
                                    null,

                                role:
                                    artist.role ??
                                    null
                            })
                        )
                },

                lyrics: {
                    status:
                        recording.lyricsStatus ??
                        "unknown",

                    syncType:
                        recording.lyrics?.syncType ??
                        null,

                    language:
                        recording.lyrics?.language ??
                        null,

                    provider:
                        recording.lyrics?.provider ??
                        null,

                    providerLyricsId:
                        recording.lyrics?.providerLyricsId ??
                        null,

                    lines:
                        (
                            recording.lyrics?.lines ??
                            []
                        ).map(
                            line => ({
                                startTimeMs:
                                    line.startTimeMs,

                                words:
                                    line.words
                            })
                        )
                },

                provenance: {
                    playlistOccurrences:
                        (
                            recording.playlistOccurrences ??
                            []
                        ).map(
                            occurrence => ({
                                position:
                                    occurrence.playlistPosition,

                                spotifyUri:
                                    occurrence.spotifyUri,

                                albumUri:
                                    occurrence.albumUri ??
                                    null,

                                albumName:
                                    occurrence.albumName ??
                                    null
                            })
                        )
                }
            };
        }

        target.recordings =
            recordings;

        target.stats.uniqueRecordings =
            Object.keys(
                recordings
            ).length;

        const values =
            Object.values(
                recordings
            );

        target.stats.lyrics.available =
            values.filter(
                recording =>
                    recording.lyrics.status ===
                    "available"
            ).length;

        target.stats.lyrics.unavailable =
            values.filter(
                recording =>
                    recording.lyrics.status ===
                    "unavailable"
            ).length;

        target.stats.lyrics.pending =
            values.filter(
                recording =>
                    recording.lyrics.status ===
                    "pending"
            ).length;

        target.stats.lyrics.error =
            values.filter(
                recording =>
                    recording.lyrics.status ===
                    "error"
            ).length;

        return target;
    }


    function buildV2Artists(
        source,
        target
    ) {
        const artists = {};

        for (
            const artist
            of Object.values(
                source.artists ?? {}
            )
        ) {
            const key =
                artist.spotifyUri;

            if (!key) {
                console.warn(
                    "Skipping artist without Spotify URI:",
                    artist
                );

                continue;
            }

            artists[key] = {
                spotifyUri:
                    artist.spotifyUri,

                name:
                    artist.name ??
                    null,

                biography: {
                    status:
                        artist.artistOverviewStatus ??
                        "unknown",

                    text:
                        artist.artistOverview?.biography ??
                        null
                }
            };
        }

        target.artists =
            artists;

        target.stats.uniqueArtists =
            Object.keys(
                artists
            ).length;

        const values =
            Object.values(
                artists
            );

        target.stats.artistBiographies.available =
            values.filter(
                artist =>
                    artist.biography.status ===
                    "available"
            ).length;

        target.stats.artistBiographies.unavailable =
            values.filter(
                artist =>
                    artist.biography.status ===
                    "unavailable"
            ).length;

        target.stats.artistBiographies.error =
            values.filter(
                artist =>
                    artist.biography.status ===
                    "error"
            ).length;

        return target;
    }


    function buildTriviaV2(source) {
        const target =
            createTriviaV2Skeleton(
                source
            );

        buildV2PlaylistEntries(
            source,
            target
        );

        buildV2Recordings(
            source,
            target
        );

        buildV2Artists(
            source,
            target
        );

        return target;
    }


    // ============================================================
    // SCHEMA VALIDATION
    // ============================================================

    function validateTriviaV2(data) {
        const entries =
            data.source?.entries ??
            [];

        const recordings =
            Object.values(
                data.recordings ?? {}
            );

        const artists =
            Object.values(
                data.artists ?? {}
            );

        const brokenRecordingReferences =
            entries.filter(
                entry =>
                    !entry.recordingKey ||
                    !data.recordings[
                        entry.recordingKey
                    ]
            );

        const brokenArtistReferences =
            [];

        for (
            const recording
            of recordings
        ) {
            for (
                const artist
                of recording.artists ?? []
            ) {
                if (
                    artist.spotifyUri &&
                    !data.artists[
                        artist.spotifyUri
                    ]
                ) {
                    brokenArtistReferences.push({
                        recordingKey:
                            recording.recordingKey,

                        title:
                            recording.title,

                        artistUri:
                            artist.spotifyUri,

                        artistName:
                            artist.name
                    });
                }
            }
        }

        const recordingKeyMismatches =
            Object.entries(
                data.recordings ?? {}
            ).filter(
                ([key, recording]) =>
                    key !==
                    recording.recordingKey
            );

        const artistKeyMismatches =
            Object.entries(
                data.artists ?? {}
            ).filter(
                ([key, artist]) =>
                    key !==
                    artist.spotifyUri
            );

        return {
            schemaVersion:
                data.schemaVersion,

            playlistEntries:
                entries.length,

            uniqueRecordings:
                recordings.length,

            uniqueArtists:
                artists.length,

            brokenRecordingReferences:
                brokenRecordingReferences.length,

            brokenArtistReferences:
                brokenArtistReferences.length,

            recordingKeyMismatches:
                recordingKeyMismatches.length,

            artistKeyMismatches:
                artistKeyMismatches.length,

            recordingsMissingDuration:
                recordings.filter(
                    recording =>
                        recording.durationMs ==
                        null
                ).length,

            recordingsMissingTitle:
                recordings.filter(
                    recording =>
                        !recording.title
                ).length,

            recordingsMissingArtists:
                recordings.filter(
                    recording =>
                        !recording.artists?.length
                ).length,

            lyricsAvailable:
                recordings.filter(
                    recording =>
                        recording.lyrics?.status ===
                        "available"
                ).length,

            lyricsUnavailable:
                recordings.filter(
                    recording =>
                        recording.lyrics?.status ===
                        "unavailable"
                ).length,

            lyricsPending:
                recordings.filter(
                    recording =>
                        recording.lyrics?.status ===
                        "pending"
                ).length,

            biographyAvailable:
                artists.filter(
                    artist =>
                        artist.biography?.status ===
                        "available"
                ).length,

            biographyUnavailable:
                artists.filter(
                    artist =>
                        artist.biography?.status ===
                        "unavailable"
                ).length
        };
    }


    // ============================================================
    // DOWNLOAD
    // ============================================================

    function downloadTriviaJSON(
        data,
        filename
    ) {
        const json =
            JSON.stringify(
                data,
                null,
                2
            );

        // Sanity check.
        JSON.parse(json);

        const blob =
            new Blob(
                [json],
                {
                    type:
                        "application/json;charset=utf-8"
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement(
                "a"
            );

        link.href =
            url;

        link.download =
            filename;

        document.body.appendChild(
            link
        );

        link.click();
        link.remove();

        URL.revokeObjectURL(
            url
        );

        console.log(
            `Downloaded ${filename}`
        );

        console.log(
            `${json.length.toLocaleString()} characters`
        );
    }


    // ============================================================
    // QUESTION GENERATION INPUT
    // ============================================================

    function buildQuestionGenerationInput(
        recording,
        source
    ) {
        const artistProfiles =
            (recording.artists ?? [])
                .map(
                    recordingArtist => {
                        const artist =
                            source.artists?.[
                                recordingArtist.spotifyUri
                            ];

                        return {
                            spotifyUri:
                                recordingArtist.spotifyUri,

                            name:
                                recordingArtist.name,

                            biography:
                                artist?.biography?.status ===
                                "available"
                                    ? artist.biography.text
                                    : null
                        };
                    }
                );

        return {
            recording: {
                recordingKey:
                    recording.recordingKey,

                spotifyUri:
                    recording.spotifyUri,

                canonicalUri:
                    recording.canonicalUri,

                isrc:
                    recording.isrc,

                title:
                    recording.title,

                artists:
                    recording.artists,

                durationMs:
                    recording.durationMs,

                metadata: {
                    popularity:
                        recording.metadata?.popularity ??
                        null,

                    originalTitle:
                        recording.metadata?.originalTitle ??
                        null,

                    artistRoles:
                        recording.metadata?.artistRoles ??
                        [],

                    languages:
                        recording.metadata?.languages ??
                        []
                },

                lyrics: {
                    status:
                        recording.lyrics?.status ??
                        "unknown",

                    language:
                        recording.lyrics?.language ??
                        null,

                    syncType:
                        recording.lyrics?.syncType ??
                        null,

                    lines:
                        recording.lyrics?.lines ??
                        []
                }
            },

            artists:
                artistProfiles
        };
    }


    // ============================================================
    // QUESTION GENERATION PROMPT
    // ============================================================

    function buildQuestionPrompt(
        generationRequest,
        candidateCount
    ) {
        return `You are generating candidate questions for a live music trivia game.

Generate UP TO ${candidateCount} strong question candidates.

QUALITY IS MORE IMPORTANT THAN QUANTITY.
If the supplied source data supports only 2 or 3 strong questions,
return only those questions. Do not invent questions to reach the maximum.

GROUNDING RULES:

1. Use ONLY facts explicitly contained in SOURCE DATA below.

2. Do NOT use your own knowledge about the song, artist, album,
release history, chart history, band members, awards, events,
collaborations, or music history.

3. Do NOT infer a fact merely because you know it is true.

4. Every question must be provable directly from SOURCE DATA.

5. Do NOT generate questions about other songs, recordings, albums,
people, events, dates, or statistics unless that exact information
appears in SOURCE DATA and directly supports the question.

6. sourceFact.value must contain the ACTUAL supporting text or value
from SOURCE DATA.

BAD:
"value": "biography"

BAD:
"value": "artistRoles"

BAD:
"value": "lines[0].words"

GOOD:
"value": "Born and raised in South Detroit"

7. sourceFact.type MUST be exactly one of:
${SOURCE_FACT_TYPES.join(", ")}

8. For lyric questions:
   - sourceFact.type must be "lyric"
   - sourceFact.value must contain the exact supporting lyric
   - sourceFact.startTimeMs must contain that lyric line's timestamp

9. For artist biography questions:
   - sourceFact.type must be "artist_biography"
   - sourceFact.value must contain the exact supporting biography text
   - sourceFact.artistUri must identify the artist

QUESTION QUALITY RULES:

10. Create exactly four answer choices.
11. There must be exactly one clearly correct answer.
12. correctAnswer must be an integer from 1 through 4.
13. Vary the position of the correct answer between candidates.
Do not consistently place the correct answer in the same position.
14. Distractors must be plausible but clearly incorrect.
15. Avoid trick questions and ambiguous questions.
16. Prefer questions that would be fun in a social bar trivia game.
17. Do not create multiple questions testing essentially the same fact.
18. Do not force every available question type to appear.
19. Use only these question types:
${QUESTION_TYPES.join(", ")}
20. Use only these difficulties:
${QUESTION_DIFFICULTIES.join(", ")}
21. Do not include information in the question that SOURCE DATA
does not establish.
22. Never include the correct answer, or an obvious form of the
correct answer, in the question itself.

BAD:
Question: "Which lyric mentions 'Born and raised in South Detroit'?"
Answer: "Born and raised in South Detroit"

GOOD:
Question: "In 'Don't Stop Believin'', where was the city boy born
and raised?"
Answer: "South Detroit"

23. Do not generate a question that simply asks the player to identify
the supplied recording's title or primary artist.

BAD:
"What is the title of this Journey song?"
"Who performs 'Don't Stop Believin''?"

These facts may be used only when the question requires meaningful
knowledge or deduction beyond repeating information already supplied
by the question.

24. For lyric questions, transform the supporting lyric into a natural
trivia question rather than asking the player to select the exact
quoted lyric.

BAD:
"Which lyric says 'It goes on and on and on and on'?"

GOOD:
"In 'Don't Stop Believin'', where was the city boy born and raised?"

25. Do not create answer choices that are merely small spelling,
punctuation, or wording variations of the correct answer.
26. Prefer memorable, recognizable, surprising, or entertaining facts
over administrative metadata.
27. Questions should sound natural when read aloud by a trivia host
to a room of players.
28. A player should be able to understand the question without seeing
SOURCE DATA.
29. Avoid references to remasters, editions, metadata fields, Spotify,
ISRCs, URIs, or other database information unless such information is
itself intentionally being tested.
30. Before returning each candidate, silently check:
- Is it fully supported by SOURCE DATA?
- Is there exactly one correct answer?
- Does the question accidentally reveal the answer?
- Would this be fun or worthwhile in a live music trivia game?
- Is it substantially different from the other candidates?

If any answer is no, do not return that candidate.

OUTPUT:
Return ONLY a valid JSON array.

Each candidate must have exactly this structure:
{
  "recordingKey": string,
  "questionType": string,
  "question": string,
  "answers": [string,string,string,string],
  "correctAnswer": 1 | 2 | 3 | 4,
  "difficulty": "easy" | "medium" | "hard",
  "sourceFact": {
    "type": string,
    "value": string,
    "startTimeMs": number | null,
    "artistUri": string | null
  },
  "playbackStartMs": number | null
}

SOURCE DATA:
${JSON.stringify(generationRequest.source)}`;
    }


    // ============================================================
    // AI RESPONSE PARSING
    // ============================================================

    function stripMarkdownFences(
        text
    ) {
        if (
            typeof text !==
            "string"
        ) {
            return text;
        }

        let cleaned =
            text.trim();

        if (
            cleaned.startsWith(
                "```"
            )
        ) {
            cleaned =
                cleaned.replace(
                    /^```(?:json)?\s*/i,
                    ""
                );

            cleaned =
                cleaned.replace(
                    /\s*```$/,
                    ""
                );
        }

        return cleaned.trim();
    }


    function parseCandidateArray(
        text
    ) {
        const cleaned =
            stripMarkdownFences(
                text
            );

        try {
            const parsed =
                JSON.parse(
                    cleaned
                );

            if (
                !Array.isArray(
                    parsed
                )
            ) {
                throw new Error(
                    "AI response JSON was not an array."
                );
            }

            return parsed;
        } catch (firstError) {
            const start =
                cleaned.indexOf("[");

            const end =
                cleaned.lastIndexOf("]");

            if (
                start === -1 ||
                end === -1 ||
                end <= start
            ) {
                throw firstError;
            }

            const candidateText =
                cleaned.slice(
                    start,
                    end + 1
                );

            const parsed =
                JSON.parse(
                    candidateText
                );

            if (
                !Array.isArray(
                    parsed
                )
            ) {
                throw firstError;
            }

            return parsed;
        }
    }


    function normalizeCandidate(
        raw,
        recordingKey
    ) {
        return {
            candidateId:
                null,

            recordingKey:
                raw.recordingKey ??
                recordingKey,

            questionType:
                raw.questionType ??
                null,

            question:
                raw.question ??
                null,

            answers:
                Array.isArray(
                    raw.answers
                )
                    ? raw.answers
                    : [],

            correctAnswer:
                raw.correctAnswer ??
                null,

            difficulty:
                raw.difficulty ??
                null,

            sourceFact:
                raw.sourceFact ??
                null,

            playback: {
                startMs:
                    raw.playbackStartMs ??
                    null,

                durationMs:
                    DEFAULT_CONFIG.playbackDurationMs
            },

            status:
                "pending"
        };
    }


    // ============================================================
    // WORKERS AI
    // ============================================================

    async function callQuestionWorker(
        prompt,
        workerUrl
    ) {
        const response =
            await fetch(
                workerUrl,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            prompt
                        })
                }
            );

        const responseText =
            await response.text();

        let payload;

        try {
            payload =
                JSON.parse(
                    responseText
                );
        } catch {
            throw new Error(
                `Worker returned non-JSON response (${response.status}): ${responseText}`
            );
        }

        if (!response.ok) {
            throw new Error(
                `Worker request failed (${response.status}): ${JSON.stringify(payload)}`
            );
        }

        return payload;
    }


    function extractWorkerGeneratedText(
        payload
    ) {
        if (
            typeof payload ===
            "string"
        ) {
            return payload;
        }

        if (
            typeof payload?.response ===
            "string"
        ) {
            return payload.response;
        }

        if (
            typeof payload?.generatedText ===
            "string"
        ) {
            return payload.generatedText;
        }

        if (
            typeof payload?.result?.response ===
            "string"
        ) {
            return payload.result.response;
        }

        if (
            typeof payload?.result?.choices?.[0]?.message?.content ===
            "string"
        ) {
            return payload.result.choices[0].message.content;
        }

        if (
            typeof payload?.choices?.[0]?.message?.content ===
            "string"
        ) {
            return payload.choices[0].message.content;
        }

        throw new Error(
            "Could not locate generated text in Worker response."
        );
    }


    // ============================================================
    // PUBLIC IMPORT PIPELINE
    // ============================================================

    async function importPlaylist(
        playlistUri,
        options = {}
    ) {
        if (!playlistUri) {
            throw new Error(
                "playlistUri is required."
            );
        }

        const config = {
            ...DEFAULT_CONFIG,
            ...options
        };

        console.log(
            "========================================"
        );

        console.log(
            "TriviaAdmin — Playlist Import"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Playlist: ${playlistUri}`
        );

        if (config.limit) {
            console.log(
                `Test limit: ${config.limit}`
            );
        }

        // --------------------------------------------------------
        // 1. Playlist
        // --------------------------------------------------------

        const source =
            await extractPlaylist(
                playlistUri,
                config.limit ?? null
            );

        // Save immediately so debugging/recovery is possible.
        state.workingSource =
            source;

        // --------------------------------------------------------
        // 2. Metadata
        // --------------------------------------------------------

        await enrichAllTrackMetadata(
            source,
            {
                concurrency:
                    config.metadataConcurrency,

                delayMs:
                    config.metadataDelayMs
            }
        );

        // --------------------------------------------------------
        // 3. Recording identity
        // --------------------------------------------------------

        addRecordingKeys(
            source
        );

        buildRecordings(
            source
        );

        // --------------------------------------------------------
        // 4. Lyrics
        // --------------------------------------------------------

        await enrichAllRecordingLyrics(
            source,
            {
                concurrency:
                    config.lyricsConcurrency,

                delayMs:
                    config.lyricsDelayMs
            }
        );

        // --------------------------------------------------------
        // 5. Artists
        // --------------------------------------------------------

        buildArtists(
            source
        );

        await enrichAllArtists(
            source,
            config.artistDelayMs
        );

        // --------------------------------------------------------
        // 6. Schema V2
        // --------------------------------------------------------

        const schema =
            buildTriviaV2(
                source
            );

        state.schema =
            schema;

        const validation =
            validateTriviaV2(
                schema
            );

        console.log(
            "========================================"
        );

        console.log(
            "Import complete."
        );

        console.log(
            "Schema stats:",
            schema.stats
        );

        console.log(
            "Validation:",
            validation
        );

        console.log(
            "========================================"
        );

        return schema;
    }


    // ============================================================
    // RECOVERY / REBUILD
    // ============================================================

    function requireWorkingSource() {
        if (!state.workingSource) {
            throw new Error(
                "No working source is loaded. Run TriviaAdmin.importPlaylist() first."
            );
        }

        return state.workingSource;
    }


    function rebuildSchema() {
        const source =
            requireWorkingSource();

        const schema =
            buildTriviaV2(
                source
            );

        state.schema =
            schema;

        const validation =
            validateTriviaV2(
                schema
            );

        console.log(
            "Schema rebuilt from working source."
        );

        console.log(
            "Schema stats:",
            schema.stats
        );

        console.log(
            "Validation:",
            validation
        );

        return schema;
    }


    async function retryErrors(
        options = {}
    ) {
        const source =
            requireWorkingSource();

        const config = {
            ...DEFAULT_CONFIG,
            ...options
        };

        const recordings =
            Object.values(
                source.recordings ?? {}
            );

        const artists =
            Object.values(
                source.artists ?? {}
            );

        const lyricsErrors =
            recordings.filter(
                recording =>
                    recording.lyricsStatus ===
                    "error"
            );

        const artistErrors =
            artists.filter(
                artist =>
                    artist.artistOverviewStatus ===
                    "error"
            );

        console.log(
            "========================================"
        );

        console.log(
            "TriviaAdmin — Retry Errors"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Lyrics errors to retry: ${lyricsErrors.length}`
        );

        console.log(
            `Artist biography errors to retry: ${artistErrors.length}`
        );


        // --------------------------------------------------------
        // Lyrics
        // --------------------------------------------------------

        for (
            let index = 0;
            index < lyricsErrors.length;
            index++
        ) {
            const recording =
                lyricsErrors[index];

            console.log(
                `[${index + 1}/${lyricsErrors.length}] Retrying lyrics: ${recording.trackName}`
            );

            try {
                // Refresh metadata first because Spotify's current
                // lyrics availability can change between imports.
                const rawMetadata =
                    await getTrackMetadata(
                        recording.spotifyUri
                    );

                const metadata =
                    normalizeTrackMetadata(
                        rawMetadata
                    );

                recording.metadata =
                    metadata;

                if (
                    metadata?.hasLyrics !== true
                ) {
                    recording.lyrics =
                        null;

                    recording.lyricsStatus =
                        "unavailable";

                    delete recording.lyricsError;

                    console.log(
                        `○ ${recording.trackName} — Spotify now reports no lyrics`
                    );
                } else {
                    const rawLyrics =
                        await getTrackLyrics(
                            recording.spotifyUri,
                            recording.album?.imageUri
                        );

                    const normalizedLyrics =
                        normalizeLyrics(
                            rawLyrics
                        );

                    if (normalizedLyrics) {
                        recording.lyrics =
                            normalizedLyrics;

                        recording.lyricsStatus =
                            "available";

                        delete recording.lyricsError;

                        console.log(
                            `✓ ${recording.trackName} — lyrics recovered`
                        );
                    } else {
                        recording.lyrics =
                            null;

                        recording.lyricsStatus =
                            "pending";

                        recording.lyricsError = {
                            message:
                                "Spotify metadata reports lyrics, but the lyrics endpoint returned no usable lyrics."
                        };

                        console.warn(
                            `◌ ${recording.trackName} — lyrics pending`
                        );
                    }
                }
            } catch (error) {
                recording.lyrics =
                    null;

                recording.lyricsStatus =
                    "error";

                recording.lyricsError = {
                    message:
                        error?.message ||
                        String(error) ||
                        "Lyrics retry failed."
                };

                console.error(
                    `✗ ${recording.trackName} — lyrics retry failed`,
                    error
                );
            }

            if (
                config.lyricsDelayMs > 0 &&
                index < lyricsErrors.length - 1
            ) {
                await sleep(
                    config.lyricsDelayMs
                );
            }
        }


        // --------------------------------------------------------
        // Artist biographies
        // --------------------------------------------------------

        for (
            let index = 0;
            index < artistErrors.length;
            index++
        ) {
            const artist =
                artistErrors[index];

            console.log(
                `[${index + 1}/${artistErrors.length}] Retrying artist: ${artist.name}`
            );

            try {
                const response =
                    await Spicetify.GraphQL.Request(
                        Spicetify.GraphQL.Definitions
                            .queryArtistOverview,
                        {
                            uri:
                                artist.spotifyUri,

                            locale: "",

                            preReleaseV2:
                                true
                        }
                    );

                const normalized =
                    normalizeArtistOverview(
                        response
                    );

                if (
                    normalized?.biography
                ) {
                    artist.artistOverview =
                        normalized;

                    artist.artistOverviewStatus =
                        "available";

                    delete artist.artistOverviewError;

                    console.log(
                        `✓ ${artist.name} — biography recovered`
                    );
                } else {
                    artist.artistOverview =
                        null;

                    artist.artistOverviewStatus =
                        "unavailable";

                    delete artist.artistOverviewError;

                    console.log(
                        `○ ${artist.name} — biography unavailable`
                    );
                }
            } catch (error) {
                artist.artistOverviewStatus =
                    "error";

                artist.artistOverviewError = {
                    message:
                        error?.message ||
                        String(error) ||
                        "Artist biography retry failed."
                };

                console.error(
                    `✗ ${artist.name} — biography retry failed`,
                    error
                );
            }

            if (
                config.artistDelayMs > 0 &&
                index < artistErrors.length - 1
            ) {
                await sleep(
                    config.artistDelayMs
                );
            }
        }


        // --------------------------------------------------------
        // Rebuild Schema V2
        // --------------------------------------------------------

        const schema =
            rebuildSchema();

        console.log(
            "========================================"
        );

        console.log(
            "Retry complete."
        );

        console.log(
            "========================================"
        );

        return schema;
    }


    // ============================================================
    // PUBLIC API HELPERS
    // ============================================================

    function validateCurrentSchema() {
        const schema =
            requireSchema();

        const result =
            validateTriviaV2(
                schema
            );

        console.log(
            result
        );

        return result;
    }


    function downloadSchema(
        filename =
            "trivia-schema-v2.json"
    ) {
        const schema =
            requireSchema();

        downloadTriviaJSON(
            schema,
            filename
        );
    }


    function getRecording(
        recordingKey
    ) {
        const schema =
            requireSchema();

        const recording =
            schema.recordings?.[
                recordingKey
            ];

        if (!recording) {
            throw new Error(
                `Recording not found: ${recordingKey}`
            );
        }

        return recording;
    }


    function getRecordings() {
        const schema =
            requireSchema();

        return Object.values(
            schema.recordings ?? {}
        );
    }


    function findRecordings(
        searchText
    ) {
        const schema =
            requireSchema();

        const query =
            String(
                searchText ?? ""
            )
                .trim()
                .toLowerCase();

        if (!query) {
            return [];
        }

        return Object.values(
            schema.recordings ?? {}
        ).filter(recording => {
            const title =
                recording.title?.toLowerCase() ??
                "";

            const artistNames =
                (recording.artists ?? [])
                    .map(
                        artist =>
                            artist.name ??
                            ""
                    )
                    .join(" ")
                    .toLowerCase();

            return (
                title.includes(query) ||
                artistNames.includes(query)
            );
        });
    }


    function buildGenerationInput(
        recordingKey
    ) {
        const schema =
            requireSchema();

        const recording =
            getRecording(
                recordingKey
            );

        return buildQuestionGenerationInput(
            recording,
            schema
        );
    }


    function buildGenerationPrompt(
        recordingKey,
        {
            candidateCount =
                DEFAULT_CONFIG.candidateCount
        } = {}
    ) {
        const source =
            buildGenerationInput(
                recordingKey
            );

        const generationRequest = {
            source
        };

        const prompt =
            buildQuestionPrompt(
                generationRequest,
                candidateCount
            );

        console.log(
            `Prompt length: ${prompt.length.toLocaleString()} characters`
        );

        return prompt;
    }


    async function generateQuestions(
        recordingKey,
        {
            candidateCount =
                DEFAULT_CONFIG.candidateCount,

            workerUrl =
                DEFAULT_CONFIG.workerUrl
        } = {}
    ) {
        const source =
            buildGenerationInput(
                recordingKey
            );

        const generationRequest = {
            source
        };

        const prompt =
            buildQuestionPrompt(
                generationRequest,
                candidateCount
            );

        console.log(
            `Generating up to ${candidateCount} candidates...`
        );

        console.log(
            `Prompt length: ${prompt.length.toLocaleString()} characters`
        );

        if (
            prompt.length >
            20000
        ) {
            console.warn(
                "Prompt exceeds the Worker's known 20,000-character input guard."
            );
        }

        const workerResponse =
            await callQuestionWorker(
                prompt,
                workerUrl
            );

        const generatedText =
            extractWorkerGeneratedText(
                workerResponse
            );

        const rawCandidates =
            parseCandidateArray(
                generatedText
            );

        const candidates =
            rawCandidates.map(
                candidate =>
                    normalizeCandidate(
                        candidate,
                        recordingKey
                    )
            );

        const result = {
            recordingKey,
            source,

            promptLength:
                prompt.length,

            workerUrl,

            rawWorkerResponse:
                workerResponse,

            rawGeneratedText:
                generatedText,

            rawCandidates,

            candidates
        };

        state.lastGeneration =
            result;

        console.log(
            `Received ${candidates.length} candidate question(s).`
        );

        console.log(
            candidates
        );

        return result;
    }


    // ============================================================
    // PUBLIC OBJECT
    // ============================================================

    const api = {
        version:
            "milestones-1-6",

        config:
            DEFAULT_CONFIG,

        state,

        importPlaylist,

        retryErrors,

        rebuildSchema,

        validate:
            validateCurrentSchema,

        downloadSchema,

        getRecording,

        getRecordings,

        findRecordings,

        buildGenerationInput,

        buildGenerationPrompt,

        generateQuestions,

        // Exposed primarily for debugging.
        helpers: {
            extractPlaylist,
            getTrackMetadata,
            normalizeTrackMetadata,
            getTrackLyrics,
            normalizeLyrics,
            normalizeArtistOverview,
            validateTriviaV2,
            downloadTriviaJSON
        }
    };


    console.log(
        "TriviaAdmin loaded successfully."
    );

    console.log(
        "Version:",
        api.version
    );

    return api;
})();