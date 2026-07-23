import type { ReactNode } from "react";
import type { Page } from "../route";
import { Mascot } from "./Kawaii";

const navigationItems = [
  { route: "today", href: "#/today", label: "今日" },
  { route: "fixtures", href: "#/fixtures", label: "賽程" },
  { route: "performance", href: "#/performance", label: "表現" },
] as const;

function Navigation(props: { route: Page }) {
  return (
    <nav className="app-navigation" aria-label="主導航">
      <ul>
        {navigationItems.map((item) => (
          <li key={item.route}>
            <a href={item.href} aria-current={item.route === props.route ? "page" : undefined}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell(props: {
  route: Page;
  dataWarning?: string;
  onLogout?: () => void;
  children: ReactNode;
}): React.ReactElement {
  const hasWarning = Boolean(props.dataWarning?.trim());

  return (
    <div className="application-shell">
      <img className="app-wallpaper" src="/chiikawa-wallpaper.png" alt="" aria-hidden="true" />
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <div className="application-shell__content">
        {hasWarning ? (
          <div className="app-shell__alert" role="alert">
            <Mascot pose="momonga-alert" />
            {props.dataWarning}
          </div>
        ) : null}
        <main id="main-content" tabIndex={-1}>
          {props.children}
        </main>
        <Mascot pose="chiikawa-top-left" />
        {props.onLogout ? (
          <button className="logout-button" onClick={props.onLogout} type="button">
            登出
          </button>
        ) : null}
      </div>
      <Navigation route={props.route} />
    </div>
  );
}
