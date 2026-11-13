import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal/LegalPage";
import { getStationConfig } from "@/lib/station-config";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  const { name } = getStationConfig();
  return (
    <LegalPage title="Terms of Use" updated="13 November 2026">
      <p>
        By using {name} (the website, the player and the installable app) you agree to these terms. If you do
        not agree, please do not use the service.
      </p>

      <h2>1. The service</h2>
      <p>
        {name} is a free internet radio stream for personal, non-commercial listening. We provide it “as is” and
        “as available”: the stream may be interrupted, changed or discontinued at any time, without notice. Some
        presenters and on-air segments are generated with the help of AI and may occasionally contain mistakes.
      </p>

      <h2>2. Allowed use</h2>
      <ul>
        <li>Listen in the player, the installed app or a media player for your own personal use.</li>
        <li>
          Do not record, re-stream, rebroadcast, embed or redistribute the stream or its content, and do not play
          it in public or commercial premises, without our written permission.
        </li>
        <li>
          Do not try to overload, scrape or disrupt the service, bypass its limits, or access the staff studio
          without authorisation.
        </li>
      </ul>

      <h2>3. Requests, suggestions and voice notes</h2>
      <p>When you send a song request, suggestion, message or voice note, you confirm that:</p>
      <ul>
        <li>it does not contain anything illegal, hateful, harassing, obscene or defamatory,</li>
        <li>it does not contain other people’s personal data without their consent,</li>
        <li>you have the right to send it, and a voice note contains your own voice.</li>
      </ul>
      <p>
        You allow us to broadcast it on {name} free of charge: read out, voiced by an AI presenter or played as
        recorded. Sending something does not guarantee it will be played. The station team may decline, shorten
        or remove anything at its sole discretion. Abuse may lead to blocking.
      </p>

      <h2>4. Music and content</h2>
      <p>
        Music, artwork, names and trademarks belong to their respective owners. Song suggestions are only
        proposals; the station decides what is added to the library.
      </p>

      <h2>5. Liability</h2>
      <p>
        To the extent permitted by law, we are not liable for any damage arising from the use of, or inability
        to use, the service, or from content broadcast on it, including AI-generated segments. Nothing in these
        terms limits rights you have as a consumer under mandatory law.
      </p>

      <h2>6. Privacy</h2>
      <p>
        How we handle personal data is described in our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>7. Changes and contact</h2>
      <p>
        We may update these terms; continued use after a change means you accept the new version. These terms
        are governed by the laws of the Czech Republic. Questions: contact us via <ContactLine />.
      </p>
    </LegalPage>
  );
}
