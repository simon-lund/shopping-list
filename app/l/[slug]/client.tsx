"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rememberList } from "@/app/recent-lists";

/**
 * Keeps everyone in the group roughly in sync by re-fetching the server
 * component every few seconds while the tab is visible. Simpler than
 * websockets and plenty for a shopping list.
 */
export function LiveList({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  useEffect(() => rememberList({ id, name }), [id, name]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  return null;
}

export function ShareButton() {
  const [label, setLabel] = useState("Share this list");

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // Cancelled — fall through to copying instead.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLabel("Link copied");
      setTimeout(() => setLabel("Share this list"), 2000);
    } catch {
      setLabel(url);
    }
  }

  return (
    <button type="button" className="link" onClick={share}>
      {label}
    </button>
  );
}
