import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal/LegalPage";
import { getStationConfig } from "@/lib/station-config";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const { name } = getStationConfig();
  return (
    <LegalPage title="Privacy Policy" updated="13 November 2026">
      <p>
        {name} is a small, non-commercial internet radio. We collect as little as possible: there are no
        listener accounts, no advertising and no tracking or analytics cookies. This page explains what we
        process when you listen or send us something, and why.
      </p>

      <h2>1. Listening to the stream</h2>
      <ul>
        <li>
          To deliver audio, our server necessarily sees your IP address and basic technical data your browser
          sends (such as the user agent). We use the IP address only while you are connected, to limit how many
          streams a single address can open (protection against abuse). We do not keep it in a listener log.
        </li>
        <li>
          We count how many people are listening at a given time. These counts are anonymous numbers (for
          example “12 listeners at 18:00”) and contain no personal data.
        </li>
      </ul>

      <h2>2. Song requests and suggestions</h2>
      <p>When you request a song or suggest a new one, we store what you send:</p>
      <ul>
        <li>the song you picked or suggested,</li>
        <li>an optional name or nickname and an optional message (dedication),</li>
        <li>an optional voice note, if you record one,</li>
        <li>the time of sending.</li>
      </ul>
      <p>
        Requests are reviewed by the station team. An approved request may be{" "}
        <strong>mentioned on air</strong>: the song is played and your name and message (or your voice note) may
        be read out or played to everyone listening. Please do not include anything you would not want
        broadcast. To prevent spam, your IP address is used temporarily to limit how many requests can be sent
        in a short time.
      </p>

      <h2>3. AI presenters and service providers</h2>
      <p>
        Some on-air segments are written and voiced with the help of AI. For a single segment, the following
        providers may receive the information it needs, for example the song title, your name and message from
        an approved request, or the audio of a voice note:
      </p>
      <ul>
        <li>a text-generation provider (NVIDIA API Catalog or Anthropic), to write the presenter’s script,</li>
        <li>ElevenLabs, to turn the script into speech and to transcribe voice notes into text,</li>
        <li>the hosting provider of our server, where the station runs and data is stored.</li>
      </ul>
      <p>
        Weather and news mentioned on air come from public sources (Open-Meteo, ČT24, iROZHLAS). No listener
        data is sent to them.
      </p>

      <h2>4. Data stored in your browser</h2>
      <p>
        The player saves a few settings only in your own browser (local storage), never on our server: volume,
        stream quality, when you closed the “add to home screen” offer, the name you last used and a list of the
        requests you sent (so you can see their status). You can delete them at any time by clearing this
        site’s data in your browser. The installed app (PWA) also stores its icons so it can open offline.
      </p>
      <p>
        The only cookie we set is a technical session cookie for the staff studio login. Listeners never receive
        it.
      </p>

      <h2>5. How long we keep data</h2>
      <p>
        Requests, suggestions, messages and voice notes are kept only as long as needed to run the programme and
        moderate the station, and are deleted when no longer needed. Anonymous listener statistics may be kept
        longer.
      </p>

      <h2>6. Legal basis and your rights</h2>
      <p>
        We process what you send us because you chose to send it (to have it played or considered), and we
        process technical data to deliver the stream and protect it from abuse (legitimate interest). Under the
        GDPR you may ask what we hold about you, ask for correction or deletion, object to processing, and
        complain to your data protection authority (in the Czech Republic: Úřad pro ochranu osobních údajů,
        uoou.gov.cz).
      </p>
      <p>
        To exercise your rights or ask anything about privacy, contact us via <ContactLine />.
      </p>

      <h2>7. Children</h2>
      <p>
        The radio is for a general audience. If you are under 16, please do not send your voice or personal
        details without a parent’s permission.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this policy when the station changes. The date at the top shows the latest version. See
        also our <Link href="/terms">Terms of Use</Link>.
      </p>
    </LegalPage>
  );
}
