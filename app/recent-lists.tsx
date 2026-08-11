"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type RecentList = { id: string; name: string };

const KEY = "shopping-list:recent";

export function readRecent(): RecentList[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remembers lists you opened, since there are no accounts to look them up with. */
export function rememberList(list: RecentList) {
  const next = [list, ...readRecent().filter((l) => l.id !== list.id)].slice(0, 10);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export default function RecentLists() {
  const [lists, setLists] = useState<RecentList[]>([]);

  useEffect(() => setLists(readRecent()), []);

  if (lists.length === 0) return null;

  return (
    <div className="card">
      <p className="muted" style={{ margin: "0 0 0.5rem" }}>
        Your lists
      </p>
      {lists.map((list) => (
        <div key={list.id}>
          <Link href={`/l/${list.id}`}>{list.name}</Link>
        </div>
      ))}
    </div>
  );
}
