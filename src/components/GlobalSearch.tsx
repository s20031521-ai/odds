import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { filterFixturePicks, formatFixturePickLabel, type FixturePick } from "../fixtureSearch";
import { formatKickoff } from "./PickCard";

/**
 * Global topbar search: searches fixtures + teams (alias-aware via
 * filterFixturePicks) and jumps straight to that fixture on the fixtures page.
 * 鍵盤：↑↓ 揀結果、Enter 直入、撳 `/` 喺任何頁 focus 搜尋框。
 */
export function GlobalSearch(props: { fixtures: FixturePick[] }): React.ReactElement {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => (query.trim() ? filterFixturePicks(props.fixtures, query, 8) : []),
    [props.fixtures, query],
  );

  // 新搜尋由第一個結果開始
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // 撳 `/` 任何頁都直達搜尋（打字緊嘅時候唔攔截）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function goToFixtures(fixture?: FixturePick) {
    setOpen(false);
    setQuery("");
    window.location.hash = fixture?.matchId
      ? `#/fixtures?m=${encodeURIComponent(fixture.matchId)}`
      : "#/fixtures";
  }

  return (
    <div className="global-search" ref={rootRef}>
      <Search size={16} className="global-search__icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="搜尋賽程、球隊…（撳 / 直達）"
        aria-label="全局搜尋"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown" && results.length > 0) {
            event.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (event.key === "ArrowUp" && results.length > 0) {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          }
          if (event.key === "Enter" && results.length > 0) {
            goToFixtures(results[Math.min(activeIndex, results.length - 1)]);
          }
        }}
      />
      {open && query.trim() ? (
        <div className="global-search__dropdown" role="listbox">
          {results.length === 0 ? (
            <p className="global-search__empty">冇搵到「{query.trim()}」</p>
          ) : (
            results.map((fixture, index) => (
              <button
                key={`${fixture.status ?? "upcoming"}-${fixture.matchId}`}
                type="button"
                className={`global-search__result${index === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => goToFixtures(fixture)}
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
