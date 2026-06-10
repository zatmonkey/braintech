import Link from "next/link";

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Braintech"
      width={28}
      height={28}
      className="size-7 rounded-md"
    />
  );
}

export function LegalChrome({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold tracking-tight">braintech</span>
        </Link>
        <Link
          href="/#waitlist"
          className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
        >
          Get 10% off
        </Link>
      </nav>

      <article className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-16">
        <h1 className="serif text-4xl leading-tight tracking-[-0.02em] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Last updated {updated}
        </p>
        <div className="mt-10">{children}</div>
      </article>

      <footer className="mt-auto border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-[var(--color-ink-soft)]">
          <span>© {new Date().getFullYear()} Braintech · Mutant Ventures LLC</span>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-[var(--color-ink)]">
              Home
            </Link>
            <Link href="/compare" className="hover:text-[var(--color-ink)]">
              Compare
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--color-ink)]">
              SMS Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="serif mt-10 mb-3 text-2xl tracking-[-0.01em]">{children}</h2>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 leading-relaxed text-[var(--color-ink-soft)]">
      {children}
    </p>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mb-4 ml-5 list-disc space-y-2 leading-relaxed text-[var(--color-ink-soft)]">
      {children}
    </ul>
  );
}
