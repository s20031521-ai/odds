import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { filterFixturePicks, formatFixturePickLabel, type FixturePick } from "../fixtureSearch";
import { formatKickoff } from "./PickCard";

/**
 * Global topbar search (C1 simple version): searches fixtures + teams
 * (alias-aware via filterFixturePicks) and jumps to the fixtures page.
 */
export function GlobalSearch(props: { fixtures: FixturePick[] }): React.ReactElement {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => (query.trim() ? filterFixturePicks(props.fixtures, query, 8) : []),
    [props.fixtures, query],
  );

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function goToFixtures() {
    setOpen(false);
    setQuery("");
    window.location.hash = "#/fixtures";
  }

  return (
    <div className="global-search" ref={rootRef}>
      <Search size={16} className="global-search__icon" aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder="搜尋賽程、球隊…"
        aria-label="全局搜尋"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && results.length > 0) goToFixtures();
        }}
      />
      {open && query.trim() ? (
        <div className="global-search__dropdown" role="listbox">
          {results.length === 0 ? (
            <p className="global-search__empty">冇搵到「{query.trim()}」</p>
          ) : (
            results.map((fixture) => (
              <button
                key={`${fixture.status ?? "upcoming"}-${fixture.matchId}`}
                type="button"
                className="global-search__result"
                onClick={goToFixtures}
              >
                <span className="global-search__teams">{formatFixturePickLabel(fixture)}</span>
                <span className="global-search__meta">
                  {fixture.league ? `${fixture.league} · ` : ""}
                  {fixture.commenceTime ? formatKickoff(fixture.commenceTime) : ""}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
