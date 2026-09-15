"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** A tiny page for a moved route: static meta refresh plus a client redirect, and a link as the fallback. */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${BASE}${to}`} />
      <div className="px-6 py-16 text-sm text-paper-3">
        This page moved. <Link href={to} className="text-brass underline underline-offset-4">Continue to {to}</Link>
      </div>
    </>
  );
}
