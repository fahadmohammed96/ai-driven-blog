import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Blogs Manager</h1>
      <p>L&apos;AI propone, l&apos;umano conferma.</p>
      <p>
        <Link href="/hub">Apri il Content Hub →</Link>
      </p>
    </main>
  );
}
