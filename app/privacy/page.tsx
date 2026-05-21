import type { Metadata } from "next";
import { LegalChrome, H2, P, UL } from "../legal-chrome";

export const metadata: Metadata = {
  title: "Privacy Policy — Braintech",
  description:
    "How Braintech collects, uses, and protects your information. We do not sell your data or share it with third parties for marketing.",
};

const CONTACT = "support@mutant.ventures";

export default function PrivacyPage() {
  return (
    <LegalChrome title="Privacy Policy" updated="May 21, 2026">
      <P>
        This Privacy Policy explains how Braintech (&ldquo;Braintech,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us&rdquo;), a product of Mutant Ventures LLC,
        collects, uses, and protects your information when you join our waitlist
        and exchange text messages with us. Questions? Email{" "}
        <a className="underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        .
      </P>

      <H2>Information we collect</H2>
      <P>We only collect what we need to run the waitlist and set up your account:</P>
      <UL>
        <li>
          <strong>Information you give us:</strong> your email address, your
          mobile phone number, and the details you choose to share in our text
          conversation (for example, how many children you have, their ages, and
          what you want help with).
        </li>
        <li>
          <strong>Information collected automatically:</strong> basic website
          analytics (pages viewed, referring source, approximate region) via
          Google Analytics, your IP address and browser type, and which version
          of our marketing page you saw.
        </li>
      </UL>

      <H2>How we use your information</H2>
      <UL>
        <li>To operate the founding-member waitlist and reserve your device.</li>
        <li>
          To send you text messages that welcome you, set up your account, and
          ask a few onboarding questions.
        </li>
        <li>To contact you about Braintech and your reservation.</li>
        <li>To understand and improve our product and marketing.</li>
      </UL>

      <H2>We do not sell or share your data for marketing</H2>
      <P>
        <strong>
          No mobile information will be shared with third parties or affiliates
          for marketing or promotional purposes.
        </strong>{" "}
        We do not sell your personal information. Text-messaging opt-in data and
        consent will not be shared with any third parties.
      </P>
      <P>
        We use a small number of trusted service providers strictly to operate
        Braintech on our behalf — for example, Twilio (to send and receive text
        messages), Anthropic (to power the messaging assistant), and Vercel and
        Neon (to host the site and store data). These providers process your
        information only to provide their service to us, under contract, and may
        not use it for their own marketing.
      </P>

      <H2>Text messages</H2>
      <P>
        You opt in to texts by entering your phone number on our waitlist form
        and agreeing to our notice. Message frequency varies. Message and data
        rates may apply. Reply <strong>STOP</strong> at any time to opt out, or{" "}
        <strong>HELP</strong> for help. See our{" "}
        <a className="underline" href="/terms">
          SMS Terms &amp; Conditions
        </a>{" "}
        for details.
      </P>

      <H2>Data retention &amp; your choices</H2>
      <UL>
        <li>
          We keep your information while you are on the waitlist or a member, and
          delete it on request.
        </li>
        <li>
          Reply <strong>STOP</strong> to stop receiving texts at any time.
        </li>
        <li>
          To access or delete your information, email{" "}
          <a className="underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </li>
      </UL>

      <H2>Children&apos;s privacy</H2>
      <P>
        Braintech is intended for parents and guardians (adults). We do not
        knowingly collect information directly from children. Any information you
        share about your children is used only to tailor Braintech for your
        family and is covered by this policy.
      </P>

      <H2>Changes</H2>
      <P>
        We may update this policy from time to time; we will revise the
        &ldquo;Last updated&rdquo; date above when we do.
      </P>

      <H2>Contact</H2>
      <P>
        Braintech (Mutant Ventures LLC) ·{" "}
        <a className="underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
      </P>
    </LegalChrome>
  );
}
