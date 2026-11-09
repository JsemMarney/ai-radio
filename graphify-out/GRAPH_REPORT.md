# Graph Report - ai-radio - Original  (2026-11-06)

## Corpus Check
- 147 files · ~71,274 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .example 2, (none) 1, .xml 1)

## Summary
- 1295 nodes · 3176 edges · 67 communities (62 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.84)
- Token cost: 139,338 input · 0 output

## Community Hubs (Navigation)
- Radio Engine Core
- Listener Messages & Requests
- Studio Auth & Proxy
- Spotify Import Jobs
- Audio Mastering & Fades
- Deploy & Docs Overview
- Radio State & Locking
- Studio Tabs UI
- Broadcaster HTTP Server
- Radio Provider & Schedule
- AI DJ Segments
- yt-dlp Track Download
- Broker Queue Routes
- Track Library Store
- Listener Request Panels
- Remaster Pipeline
- AI DJ State & Clock
- Icecast Config & Stats
- Broadcast UI Widgets
- PCM Deck & Encoder
- Dev Dependencies
- Studio Client Shell
- Player Page
- Engine Logging & Context
- Studio Mic & Break Panels
- TypeScript Config
- Icecast Script & Env
- Scheduled Programming
- Release Bundling
- Signed Stream URLs
- NPM Scripts
- Station Config
- FFmpeg Helpers
- Icecast Source Client
- Mix Analysis & Loudness
- Broker Control Routes
- Rotation Playlist
- Library Zip Script
- Event Stream Routes
- Now Playing API
- Program Schedule View
- Listener Stats
- Voice Note Playback
- Track Deletion
- Talk Bed Music
- WebSocket Lite
- Play & Midsong Test
- Runtime Dependencies
- Voice Note Storage
- ESLint Config
- Studio Health Check
- Agent Instructions
- AI DJ Now Route
- Queue Route
- Break Beds Route
- Listener Stats Route
- Full Queue Route
- Moderation Route
- Request Status Route
- Skip Route
- Radio Stats Route
- Radio Status Route
- Transition Preview Route
- Scaffold Icons
- PostCSS Config
- Brand Logo
- Next & Vercel Logos

## God Nodes (most connected - your core abstractions)
1. `RadioEngine` - 105 edges
2. `brokerFetch()` - 67 edges
3. `StudioClient()` - 43 edges
4. `getDownloadsDir()` - 29 edges
5. `react` - 27 edges
6. `probeDuration()` - 22 edges
7. `AiDj` - 21 edges
8. `listTracks()` - 21 edges
9. `next` - 20 edges
10. `getStationConfig()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Miss Radio Pterodactyl Deployment` --semantically_similar_to--> `Public Deployment`  [INFERRED] [semantically similar]
  deploy/pterodactyl/README.md → README.md
- `Single Port (web + radio + mic)` --conceptually_related_to--> `Live Microphone (WebSocket /mic)`  [INFERRED]
  deploy/pterodactyl/README.md → README.md
- `BROKER_SECRET` --conceptually_related_to--> `Environment Variables (.env.local)`  [INFERRED]
  deploy/pterodactyl/README.md → README.md
- `main()` --calls--> `getStreamPort()`  [EXTRACTED]
  scripts/broadcaster.ts → src/lib/radio-broker.ts
- `main()` --calls--> `getIcecastPort()`  [EXTRACTED]
  scripts/icecast.ts → src/lib/icecast-config.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Spotify import pipeline** — readme_spotify_import, readme_spotify_api, readme_yt_dlp, readme_ffmpeg, readme_downloads_dir [EXTRACTED 1.00]
- **Broadcast mixing and streaming** — readme_broadcaster, readme_crossfade, readme_smart_mix, readme_rotation, readme_fallback_jingle, readme_microphone, readme_radio_stream [INFERRED 0.85]
- **HTTPS reverse-proxy deployment** — readme_public_deployment, readme_trust_proxy, deploy_pterodactyl_readme_https_mic, readme_microphone [INFERRED 0.75]
- **Next.js starter template assets** — public_file, public_globe, public_next, public_vercel, public_window [INFERRED 0.95]

## Communities (67 total, 5 thin omitted)

### Community 0 - "Radio Engine Core"
Cohesion: 0.05
Nodes (15): randomMidsongInterval(), getCrossfadeSec(), MicInput, planTransition(), PcmDeck, getBurstSec(), RadioEngine, secToFrames() (+7 more)

### Community 1 - "Listener Messages & Requests"
Cohesion: 0.06
Nodes (51): dynamic, POST(), runtime, dynamic, POST(), runtime, dynamic, GET() (+43 more)

### Community 2 - "Studio Auth & Proxy"
Cohesion: 0.06
Nodes (54): nextConfig, securityHeaders, next, dynamic, POST(), runtime, GET(), POST() (+46 more)

### Community 3 - "Spotify Import Jobs"
Cohesion: 0.07
Nodes (55): maxDuration, POST(), runtime, GET(), runtime, dynamic, GET(), runtime (+47 more)

### Community 4 - "Audio Mastering & Fades"
Cohesion: 0.06
Nodes (46): ASSETS, download(), execFileAsync, generateVoice(), mixJingle(), out, root, run() (+38 more)

### Community 5 - "Deploy & Docs Overview"
Cohesion: 0.06
Nodes (39): download(), ensureYtDlp(), fixBuildPaths(), { fork }, fs, http, https, log() (+31 more)

### Community 6 - "Radio State & Locking"
Cohesion: 0.10
Nodes (42): main(), dynamic, GET(), runtime, adjustListenerCount(), atomicWriteJson(), BrokenTrackInfo, cleanupStaleBroadcastLock() (+34 more)

### Community 7 - "Studio Tabs UI"
Cohesion: 0.08
Nodes (31): DuplicatesSection(), Figure(), importItemLabel(), ImportJobDetail(), ImportTab(), LibraryTab(), NO_STATE_RESTORE, OutlineButton() (+23 more)

### Community 8 - "Broadcaster HTTP Server"
Cohesion: 0.11
Nodes (28): RFC-6455, attachBroadcasterEngine(), handleEvents(), handleMonitorUpgrade(), handleRequest(), handleStream(), handleUpgrade(), pushSse() (+20 more)

### Community 9 - "Radio Provider & Schedule"
Cohesion: 0.10
Nodes (28): metadata, montserrat, RootLayout(), station, ConnectionState, invalidateStreamUrls(), prefersLightStream(), RadioContext (+20 more)

### Community 10 - "AI DJ Segments"
Cohesion: 0.12
Nodes (12): AiDj, cleanTags(), fetchOrExplain(), filePath(), getNameday(), getNews(), monthlyCharLimit(), spokenTime() (+4 more)

### Community 11 - "yt-dlp Track Download"
Cohesion: 0.13
Nodes (31): AudioTrim, createTrackRecord(), searchQueryForTrack(), buildDownloadArgs(), buildSearchQueries(), cookieArgs(), downloadFromSource(), execFileAsync (+23 more)

### Community 12 - "Broker Queue Routes"
Cohesion: 0.09
Nodes (21): dynamic, GET(), POST(), runtime, POST(), runtime, POST(), runtime (+13 more)

### Community 13 - "Track Library Store"
Cohesion: 0.12
Nodes (21): main(), GET(), runtime, AUDIO_EXTS, BROADCAST_FILENAME, dedupeBySpotifyId(), ensureDownloadsDir(), findAudioInDir() (+13 more)

### Community 14 - "Listener Request Panels"
Cohesion: 0.14
Nodes (15): react, LogRow(), readMine(), saveMine(), SongRequestPanel(), submit(), statusText(), Stored (+7 more)

### Community 15 - "Remaster Pipeline"
Cohesion: 0.21
Nodes (21): GET(), POST(), runtime, renderBroadcastFile(), findBroadcastInDir(), getInfoPath(), getTrackDir(), readTrackInfo() (+13 more)

### Community 16 - "AI DJ State & Clock"
Cohesion: 0.11
Nodes (18): GAP_OPTIONS, AiDjBudget, AiDjFocus, AiDjSettings, AiDjState, cache, Cached, DEFAULTS (+10 more)

### Community 17 - "Icecast Config & Stats"
Cohesion: 0.24
Nodes (19): envFlag(), escapeXml(), getIcecastAdminBaseUrl(), getIcecastAdminPassword(), getIcecastAdminUser(), getIcecastHost(), getIcecastListenUrl(), getIcecastMount() (+11 more)

### Community 18 - "Broadcast UI Widgets"
Cohesion: 0.14
Nodes (14): Cover(), DedicationNote(), listenersLabel(), LiveBadge(), NowPlaying(), OnAirLamp(), Found, SuggestPanel() (+6 more)

### Community 19 - "PCM Deck & Encoder"
Cohesion: 0.12
Nodes (9): BYTES_PER_FRAME, CHANNELS, SAMPLE_RATE, BITRATES_V1, BITRATES_V2, FrameSplitter, isAacEnabled(), SAMPLE_RATES (+1 more)

### Community 20 - "Dev Dependencies"
Cohesion: 0.13
Nodes (20): devDependencies, concurrently@^9, tailwindcss@^4, @tailwindcss/postcss@^4, tsx@^4, @types/node@^20, @types/react@^19, @types/react-dom@^19 (+12 more)

### Community 21 - "Studio Client Shell"
Cohesion: 0.12
Nodes (15): Card(), MobileAction(), postJson(), scrollToCard(), StudioClient(), moveRotation(), onDrop(), playNext() (+7 more)

### Community 22 - "Player Page"
Cohesion: 0.17
Nodes (15): PlayerPage(), Card(), LISTENER_TABS, ListenerTab, ListenerTabs(), PlayerClient(), readLastVolume(), StationClock() (+7 more)

### Community 23 - "Engine Logging & Context"
Cohesion: 0.12
Nodes (17): DjContext, pickFocus(), BroadcastSink, execFileAsync, getAutoApproveMs(), getFallbackPaths(), Output, PreparedStinger (+9 more)

### Community 24 - "Studio Mic & Break Panels"
Cohesion: 0.15
Nodes (13): useRadio(), BedOption, BreakPanel(), run(), control(), createResampler(), DUCK_OPTIONS, MicPanel() (+5 more)

### Community 25 - "TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 26 - "Icecast Script & Env"
Cohesion: 0.18
Nodes (11): main(), portInUse(), runtimePaths(), contentTypeFor(), GET(), runtime, getIcecastConfigPath(), getIcecastSecretProblem() (+3 more)

### Community 27 - "Scheduled Programming"
Cohesion: 0.16
Nodes (14): ACTION_LABEL, DAY_LABELS, DAY_ORDER, daysText(), SchedulePanel(), add(), save(), dueEntries() (+6 more)

### Community 28 - "Release Bundling"
Cohesion: 0.12
Nodes (12): esbuild@^0.28.2, esbuild, d, deploy, entries, mb, pkg, RELEASE (+4 more)

### Community 29 - "Signed Stream URLs"
Cohesion: 0.23
Nodes (13): dynamic, GET(), ICY_HEADERS, runtime, dynamic, GET(), runtime, getLinkSigningSecret() (+5 more)

### Community 30 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, build, dev, dev:all, dev:icecast, dev:radio, dev:web, generate:jingle (+6 more)

### Community 31 - "Station Config"
Cohesion: 0.20
Nodes (9): dynamic, GET(), metadata, station, metadata, StudioPage(), getIcecastStationName(), getStationConfig() (+1 more)

### Community 32 - "FFmpeg Helpers"
Cohesion: 0.27
Nodes (10): execFileAsync, FFMPEG_CANDIDATES, ffmpegStderr(), getRadioTransition(), isFileCandidate(), parseClock(), probeDuration(), probeFfmpeg() (+2 more)

### Community 34 - "Mix Analysis & Loudness"
Cohesion: 0.21
Nodes (10): computeCues(), getMixAnalysis(), getTargetLufs(), loudnessGain(), memoryCache, MixAnalysis, percentile(), runAnalysis() (+2 more)

### Community 35 - "Broker Control Routes"
Cohesion: 0.15
Nodes (9): POST(), runtime, POST(), runtime, dynamic, POST(), runtime, BrokerFetchInit (+1 more)

### Community 36 - "Rotation Playlist"
Cohesion: 0.22
Nodes (10): allArtists(), CatalogEntry, fillRotationQueue(), getArtistSpacing(), getSongSeparationRatio(), normalizeArtist(), pickRotationTrack(), QUEUE_DISPLAY_SIZE (+2 more)

### Community 37 - "Library Zip Script"
Cohesion: 0.17
Nodes (9): d, DOWNLOADS, maxArg, parts, RELEASE, ROOT, sinceArg, STAGE (+1 more)

### Community 38 - "Event Stream Routes"
Cohesion: 0.20
Nodes (8): dynamic, GET(), runtime, SSE_HEADERS, dynamic, GET(), runtime, brokerStream()

### Community 39 - "Now Playing API"
Cohesion: 0.27
Nodes (9): dynamic, GET(), runtime, getStreamBitrate(), getPublicStreamUrl(), buildNowPlayingResponse(), NowPlayingApiResponse, trackToSong() (+1 more)

### Community 40 - "Program Schedule View"
Cohesion: 0.24
Nodes (10): QueueRow(), relativeDay(), formatLength(), formatTime(), LogTime(), ProgramSchedule(), TrackTimeline(), TrackTimelineProps (+2 more)

### Community 41 - "Listener Stats"
Cohesion: 0.24
Nodes (5): filePath(), HourBucket, HourSummary, ListenerStats, ListenerStatsSummary

### Community 42 - "Voice Note Playback"
Cohesion: 0.31
Nodes (7): ago(), MessagesPanel(), postPlay(), VoiceNoteControls(), play(), stop(), ListenerMessage

### Community 43 - "Track Deletion"
Cohesion: 0.36
Nodes (8): DELETE(), detachFromRadio(), dynamic, runtime, deleteLibraryTrack(), getTrack(), isTrackId(), rmTrackDir()

### Community 44 - "Talk Bed Music"
Cohesion: 0.39
Nodes (7): getDownloadsDir(), BedOption, bedsDir(), ensureBuiltinBed(), execFileAsync, listBedOptions(), resolveBedPath()

### Community 46 - "Play & Midsong Test"
Cohesion: 0.21
Nodes (6): dynamic, POST(), runtime, dynamic, POST(), runtime

### Community 47 - "Runtime Dependencies"
Cohesion: 0.29
Nodes (7): dependencies, @anthropic-ai/sdk@^1.3.0, next@16.3.3, react@19.2.8, react-dom@19.2.8, @anthropic-ai/sdk, react-dom

### Community 48 - "Voice Note Storage"
Cohesion: 0.48
Nodes (6): cleanupVoiceNotes(), execFileAsync, saveVoiceNote(), VOICE_MAX_SEC, voiceDir(), voiceNotePath()

### Community 49 - "ESLint Config"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.3.3, eslint, eslint-config-next

### Community 50 - "Studio Health Check"
Cohesion: 0.40
Nodes (5): dynamic, GET(), runtime, execFileAsync, getToolVersions()

### Community 51 - "Agent Instructions"
Cohesion: 0.40
Nodes (3): AGENTS.md agent instructions, generate-agent-files.js (next dev), node_modules/next/dist/docs

### Community 52 - "AI DJ Now Route"
Cohesion: 0.40
Nodes (4): dynamic, maxDuration, POST(), runtime

### Community 53 - "Queue Route"
Cohesion: 0.40
Nodes (4): dynamic, EMPTY_QUEUE, GET(), runtime

### Community 54 - "Break Beds Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 55 - "Listener Stats Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 56 - "Full Queue Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 57 - "Moderation Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 58 - "Request Status Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 59 - "Skip Route"
Cohesion: 0.50
Nodes (3): dynamic, POST(), runtime

### Community 60 - "Radio Stats Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 61 - "Radio Status Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 62 - "Transition Preview Route"
Cohesion: 0.50
Nodes (3): dynamic, GET(), runtime

### Community 63 - "Scaffold Icons"
Cohesion: 0.67
Nodes (3): File Document Icon (Next.js scaffold), Globe Icon (Next.js scaffold), Browser Window Icon (Next.js scaffold)

## Knowledge Gaps
- **14 isolated node(s):** `RFC-6455`, `node_modules/next/dist/docs`, `generate-agent-files.js (next dev)`, `AI Radio`, `Fallback Jingle (public/jingle.mp3)` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 367 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Studio Auth & Proxy` to `Spotify Import Jobs`, `Deploy & Docs Overview`, `Studio Tabs UI`, `Radio Provider & Schedule`, `Track Deletion`, `Track Library Store`, `Remaster Pipeline`, `Runtime Dependencies`, `Dev Dependencies`, `Player Page`, `Station Config`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `RFC-6455`, `node_modules/next/dist/docs`, `generate-agent-files.js (next dev)` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Radio Engine Core` be split into smaller, more focused modules?**
  _Cohesion score 0.05153099327856609 - nodes in this community are weakly interconnected._
- **Why does `brokerFetch()` connect `Broker Queue Routes` to `Listener Messages & Requests`, `Studio Auth & Proxy`, `Radio State & Locking`, `Signed Stream URLs`, `Broker Control Routes`, `Event Stream Routes`, `Now Playing API`, `Track Deletion`, `Play & Midsong Test`, `Studio Health Check`, `AI DJ Now Route`, `Queue Route`, `Break Beds Route`, `Listener Stats Route`, `Full Queue Route`, `Moderation Route`, `Request Status Route`, `Skip Route`, `Radio Stats Route`, `Radio Status Route`, `Transition Preview Route`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Should `Listener Messages & Requests` be split into smaller, more focused modules?**
  _Cohesion score 0.061018437225636525 - nodes in this community are weakly interconnected._
- **Why does `RadioEngine` connect `Radio Engine Core` to `FFmpeg Helpers`, `Listener Messages & Requests`, `Mix Analysis & Loudness`, `Audio Mastering & Fades`, `Radio State & Locking`, `Studio Tabs UI`, `Broadcaster HTTP Server`, `Listener Stats`, `AI DJ Segments`, `Program Schedule View`, `Talk Bed Music`, `Track Library Store`, `AI DJ State & Clock`, `Engine Logging & Context`, `Scheduled Programming`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `Studio Auth & Proxy` be split into smaller, more focused modules?**
  _Cohesion score 0.06331976481230213 - nodes in this community are weakly interconnected._