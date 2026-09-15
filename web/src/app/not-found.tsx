import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20">
      <div className="eyebrow mb-3">404</div>
      <h1 className="font-display text-4xl">Nothing here.</h1>
      <p className="mt-4 text-paper-2">
        <Link href="/" className="text-brass underline underline-offset-4">Back to the front page.</Link>
      </p>
    </div>
  );
}
