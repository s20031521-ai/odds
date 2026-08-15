import type { ReactNode } from "react";
import { LayoutGrid, Calendar, Ticket, BarChart3, Zap, User } from "lucide-react";
import packageJson from "../../package.json";
import type { Page } from "../route";
import type { FixturePick } from "../fixtureSearch";
import { GlobalSearch } from "./GlobalSearch";

const APP_VERSION = packageJson.version;

const navigationItems = [
  { route: "today", href: "#/today", label: "今日概覽", Icon: LayoutGrid },
  { route: "fixtures", href: "#/fixtures", label: "賽程列表", Icon: Calendar },
  { route: "bets", href: "#/bets", label: "注單管理", Icon: Ticket },
  { route: "performance", href: "#/performance", label: "表現分析", Icon: BarChart3 },
] as const;

export function AppShell(props: {
  route: Page;
  dataWarning?: string;
  fixtures?: FixturePick[];
  children: ReactNode;
}): React.ReactElement {
  const hasWarning = Boolean(props.dataWarning?.trim());

  return (
    <div className="application-shell">
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-icon" aria-hidden="true">
            <Zap size={18} />
          </span>
          <span className="sidebar__brand-name">玄學賭波</span>
        </div>

        <nav className="sidebar__nav" aria-label="主導航">
          <ul>
            {navigationItems.map(({ route, href, label, Icon }) => (
              <li key={route}>
                <a href={href} aria-current={route === props.route ? "page" : undefined}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar__user">
          <span className="sidebar__avatar" aria-hidden="true">
            <User size={16} />
          </span>
          <span className="sidebar__user-meta">
            <span className="sidebar__username">單機模式</span>
            <span className="sidebar__version">v{APP_VERSION}</span>
          </span>
        </div>
      </aside>

      <div className="application-shell__main">
        <header className="topbar">
          <span className="topbar__brand">
            <Zap size={16} aria-hidden="true" />
            玄學賭波
          </span>
          <GlobalSearch fixtures={props.fixtures ?? []} />
        </header>

        <nav className="mobile-nav" aria-label="主導航（手機）">
          <ul>
            {navigationItems.map(({ route, href, label, Icon }) => (
              <li key={route}>
                <a href={href} aria-current={route === props.route ? "page" : undefined}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="application-shell__content">
          {hasWarning ? (
            <div className="app-shell__alert" role="alert">
              {props.dataWarning}
            </div>
          ) : null}
          <main id="main-content" tabIndex={-1}>
            {props.children}
          </main>
        </div>
      </div>
    </div>
  );
}
