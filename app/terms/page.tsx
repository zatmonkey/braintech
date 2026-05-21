import type { Metadata } from "next";
import { LegalChrome, H2, P, UL } from "../legal-chrome";

export const metadata: Metadata = {
  title: "SMS Terms & Conditions — Braintech",
  description:
    "Terms for the Braintech SMS program: description, message frequency, message and data rates, support contact, and how to opt out.",
};

const CONTACT = "support@mutant.ventures";
const SMS_NUMBER = "+1 (888) 464-4087";

export default function TermsPage() {
  return (
    <LegalChrome title="SMS Terms & Conditions" updated="May 21, 2026">
      <H2>Program name</H2>
      <P>Braintech (the &ldquo;Braintech&rdquo; SMS program), operated by Mutant Ventures LLC.</P>

      <H2>Program description</H2>
      <P>
        When you join the Braintech waitlist and provide your mobile number, the
        Braintech SMS program sends you a welcome message and conducts a short
        onboarding conversation — a few questions to set up your account and
        tailor Braintech to your family. These are recurring, automated text
        messages sent via an automatic telephone dialing system.
      </P>

      <H2>Message frequency</H2>
      <P>
        Message frequency varies based on your interaction with us (for example,
        replies during onboarding and occasional account updates).
      </P>

      <H2>Cost</H2>
      <P>
        <strong>Message and data rates may apply.</strong> Braintech does not
        charge for the text messages, but your mobile carrier&apos;s standard
        message and data rates may apply to messages you send and receive.
      </P>

      <H2>How to opt out and get help</H2>
      <UL>
        <li>
          Reply <strong>STOP</strong> to any message to unsubscribe. You will
          receive one confirmation message and then no further texts.
        </li>
        <li>
          Reply <strong>HELP</strong> to any message for help, or contact us
          using the support details below.
        </li>
      </UL>

      <H2>Support contact</H2>
      <P>
        For help with the Braintech SMS program, reply <strong>HELP</strong> to
        any message, email{" "}
        <a className="underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        , or text our support line at {SMS_NUMBER}.
      </P>

      <H2>Carrier liability</H2>
      <P>
        Carriers are not liable for delayed or undelivered messages. Delivery is
        subject to effective transmission by your mobile carrier and is not
        guaranteed.
      </P>

      <H2>Privacy</H2>
      <P>
        Your information is handled as described in our{" "}
        <a className="underline" href="/privacy">
          Privacy Policy
        </a>
        . No mobile information will be shared with third parties or affiliates
        for marketing or promotional purposes.
      </P>

      <H2>Eligibility &amp; the waitlist</H2>
      <P>
        Joining the waitlist reserves a founding-member spot; it is not a
        purchase, and no payment is collected at sign-up. Founding pricing of
        $249/year applies to the first 1,000 devices. We will confirm with you
        before any charge is made.
      </P>
    </LegalChrome>
  );
}
