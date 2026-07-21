import type { ReactNode } from "react";
import type { Page } from "../route";
import { KawaiiDecor, Mascot } from "./Kawaii";

const navigationItems = Object.freeze([
  { route: "dashboard", href: "#/dashboard", label: "值得買" },
  { route: "fixtures", href: "#/fixtures", label: "全部賽事" },
  { route: "history", href: "#/history", label: "完場紀錄" },
  { route: "analysis", href: "#/analysis", label: "模型健康" },
] as const);

function Navigation(props: { className: string; label: string; route: Page }) {
  return (
    <nav className={props.className} aria-label={props.label}>
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
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <div className="application-shell__content">
        <Navigation className="app-navigation app-navigation--top" label="主要導覽" route={props.route} />
        {props.onLogout ? <button className="secondary-button compact" onClick={props.onLogout} type="button">登出</button> : null}
        {hasWarning ? (
          <div className="app-shell__alert" role="alert">
            <Mascot pose="momonga-alert" />
            {props.dataWarning}
          </div>
        ) : null}
        <main id="main-content" tabIndex={-1}>
          {props.children}
        </main>
        <KawaiiDecor />
        <Mascot pose="chiikawa-corner" />
        <aside aria-label="安裝提示" className="pwa-install-hint">
          iPhone / iPad：Safari 分享 → 加入主畫面
        </aside>
      </div>
      <Navigation className="app-navigation app-navigation--bottom" label="手機導覽" route={props.route} />
    </div>
  );
}
