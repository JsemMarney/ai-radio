import { listTracks } from "../src/lib/library";
import { ensureTrackMp3 } from "../src/lib/ytdlp";

async function main() {
  const tracks = await listTracks({ readyOnly: true });
  let converted = 0;

  for (const track of tracks) {
    const before = track.audioFile;
    const result = await ensureTrackMp3(track.uuid);
    if (!result) {
      console.log(`✗ ${track.title} — soubor nenalezen`);
      continue;
    }
    if (before !== "track.mp3" && result.endsWith("track.mp3")) {
      converted++;
      console.log(`✓ ${track.title} → track.mp3`);
    } else {
      console.log(`· ${track.title} — už je mp3`);
    }
  }

  console.log(`\nHotovo. Převedeno: ${converted}/${tracks.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
