import { ImageResponse } from "next/og";
import { getItems, getList } from "@/lib/db";

export const dynamic = "force-dynamic";

const size = { width: 1200, height: 630 };
const SHOWN = 7;

/**
 * The card chat clients show when the bot posts a list link — the list as a
 * checklist, readable without opening anything.
 *
 * This is a route rather than Next's `opengraph-image` file convention because
 * that convention builds the image URL from a build-time hash, so the URL never
 * changes as the list does — and clients cache preview images by URL, which
 * left the card permanently stale. Here the caller supplies `?v=<version>`.
 *
 * Rendered by Satori, which supports a flexbox subset of CSS: every element
 * with more than one child needs an explicit `display: flex`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const list = await getList(slug);
  const items = list ? await getItems(slug) : [];

  const todo = items.filter((item) => !item.done);
  const shown = todo.slice(0, SHOWN);
  const rest = todo.length - shown.length;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#f6f6f4",
          color: "#1b1b1a",
          padding: "64px 72px",
          fontSize: 40,
        }}
      >
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700 }}>
          {list?.name ?? "Shopping list"}
        </div>
        <div style={{ display: "flex", color: "#75756f", marginTop: 8 }}>
          {todo.length === 0
            ? "Nothing left to buy"
            : `${todo.length} to buy${
                items.length - todo.length > 0
                  ? ` · ${items.length - todo.length} done`
                  : ""
              }`}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
          {shown.map((item) => (
            <div
              key={item.id}
              style={{ display: "flex", alignItems: "center", marginBottom: 18 }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  border: "4px solid #75756f",
                  borderRadius: 8,
                  marginRight: 24,
                }}
              />
              <div style={{ display: "flex" }}>{item.text}</div>
            </div>
          ))}
          {rest > 0 && (
            <div style={{ display: "flex", color: "#75756f", marginLeft: 60 }}>
              +{rest} more
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        // A versioned URL addresses one fixed list state, so it can be cached
        // hard. Without a version it is "whatever the list is now", so don't.
        "cache-control": new URL(request.url).searchParams.has("v")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=60",
      },
    },
  );
}
