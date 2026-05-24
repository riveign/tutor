import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { api } from "@/lib/api/client";

const FORMATS: Array<{ key: string; label: string }> = [
  { key: "commander", label: "Commander" },
  { key: "modern", label: "Modern" },
  { key: "pioneer", label: "Pioneer" },
  { key: "standard", label: "Standard" },
  { key: "legacy", label: "Legacy" },
  { key: "vintage", label: "Vintage" },
  { key: "pauper", label: "Pauper" },
];

function legalityLabel(value: string) {
  switch (value) {
    case "legal":
      return "Legal";
    case "not_legal":
      return "Not legal";
    case "restricted":
      return "Restricted";
    case "banned":
      return "Banned";
    default:
      return value;
  }
}

function legalityClass(value: string) {
  switch (value) {
    case "legal":
      return "text-signal-success";
    case "banned":
      return "text-signal-danger";
    case "restricted":
      return "text-signal-warning";
    default:
      return "text-fg-subtle";
  }
}

function imageUrl(uris: unknown): string | undefined {
  if (!uris || typeof uris !== "object") return undefined;
  const record = uris as Record<string, unknown>;
  const candidate = record.normal ?? record.large ?? record.small;
  return typeof candidate === "string" ? candidate : undefined;
}

export function CardDetailPage() {
  const { oracleId = "" } = useParams<{ oracleId: string }>();

  const card = useQuery({
    queryKey: ["cards.get", oracleId],
    queryFn: () => api.cards.get(oracleId),
    enabled: Boolean(oracleId),
  });

  if (card.isPending) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-fg-muted">
        Loading card&hellip;
      </main>
    );
  }

  if (card.isError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-signal-danger">
          Could not load card: {card.error.message}
        </p>
        <Link to="/cards" className="mt-4 inline-block font-mono text-xs uppercase tracking-widest text-fg hover:underline">
          ← Back to browse
        </Link>
      </main>
    );
  }

  const c = card.data;
  const legalities = (c.legalities ?? {}) as Record<string, string>;
  const heroImage = c.printings[0] ? imageUrl(c.printings[0].image_uris) : undefined;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <nav>
        <Link
          to="/cards"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle hover:text-fg"
        >
          ← Back to browse
        </Link>
      </nav>

      <header className="grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            {c.type_line}
          </p>
          <h1 className="font-serif text-4xl text-fg">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-3 font-mono text-sm text-fg-muted">
            {c.mana_cost && <span>{c.mana_cost}</span>}
            <span>CMC {c.mana_value}</span>
            <span>
              Identity:{" "}
              {c.color_identity.length ? c.color_identity.join("") : "Colorless"}
            </span>
            {c.edhrec_rank != null && (
              <span>EDHREC #{c.edhrec_rank.toLocaleString()}</span>
            )}
          </div>
          {c.keywords.length > 0 && (
            <p className="font-mono text-xs text-fg-subtle">
              {c.keywords.join(" · ")}
            </p>
          )}
          {(c.power || c.toughness) && (
            <p className="font-mono text-sm text-fg">
              {c.power ?? "?"} / {c.toughness ?? "?"}
            </p>
          )}
          {c.loyalty && (
            <p className="font-mono text-sm text-fg">Loyalty {c.loyalty}</p>
          )}
        </div>

        {heroImage && (
          <img
            src={heroImage}
            alt={c.name}
            loading="lazy"
            className="w-full rounded-lg border border-border bg-surface-raised"
          />
        )}
      </header>

      {c.faces.length === 0 && c.oracle_text && (
        <section className="rounded-lg border border-border bg-surface-raised p-6">
          <h2 className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Oracle text
          </h2>
          <p className="mt-3 whitespace-pre-line text-fg">{c.oracle_text}</p>
        </section>
      )}

      {c.faces.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {c.faces.map((face) => (
            <article
              key={face.face_index}
              className="rounded-lg border border-border bg-surface-raised p-6"
            >
              <header className="flex items-baseline justify-between">
                <h3 className="font-serif text-xl text-fg">{face.name}</h3>
                {face.mana_cost && (
                  <span className="font-mono text-sm text-fg-muted">
                    {face.mana_cost}
                  </span>
                )}
              </header>
              {face.type_line && (
                <p className="mt-1 font-mono text-xs text-fg-subtle">
                  {face.type_line}
                </p>
              )}
              {face.oracle_text && (
                <p className="mt-3 whitespace-pre-line text-sm text-fg">
                  {face.oracle_text}
                </p>
              )}
              {(face.power || face.toughness) && (
                <p className="mt-3 font-mono text-sm text-fg">
                  {face.power ?? "?"} / {face.toughness ?? "?"}
                </p>
              )}
              {face.loyalty && (
                <p className="mt-3 font-mono text-sm text-fg">
                  Loyalty {face.loyalty}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface-raised p-6">
        <h2 className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Format legality
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-4">
          {FORMATS.map(({ key, label }) => {
            const status = legalities[key] ?? "not_legal";
            return (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <dt className="text-fg-subtle">{label}</dt>
                <dd className={legalityClass(status)}>{legalityLabel(status)}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      {c.printings.length > 0 && (
        <section className="rounded-lg border border-border bg-surface-raised">
          <header className="border-b border-border px-6 py-3">
            <h2 className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Printings ({c.printings.length})
            </h2>
          </header>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border text-left font-mono text-xs uppercase tracking-widest text-fg-subtle">
              <tr>
                <th className="px-6 py-2">Set</th>
                <th className="px-6 py-2">Number</th>
                <th className="px-6 py-2">Rarity</th>
                <th className="px-6 py-2">Released</th>
                <th className="px-6 py-2">Finishes</th>
              </tr>
            </thead>
            <tbody>
              {c.printings.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-6 py-2 text-fg">
                    {p.set_name}{" "}
                    <span className="text-fg-subtle">
                      ({p.set_code.toUpperCase()})
                    </span>
                  </td>
                  <td className="px-6 py-2 font-mono text-xs text-fg-muted">
                    {p.collector_number}
                  </td>
                  <td className="px-6 py-2 font-mono text-xs text-fg-muted capitalize">
                    {p.rarity}
                  </td>
                  <td className="px-6 py-2 font-mono text-xs text-fg-muted">
                    {p.released_at ?? "—"}
                  </td>
                  <td className="px-6 py-2 font-mono text-xs text-fg-muted">
                    {p.finishes.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
