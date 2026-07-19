import type { ReactNode } from "react";

export function AllFixtures(props: {
  active?: boolean;
  marketNavigation: ReactNode;
  content: ReactNode;
}): React.ReactElement {
  if (props.active === false) return <>{props.content}</>;

  return (
    <section className="all-fixtures" aria-labelledby="all-fixtures-title">
      <header className="all-fixtures__header">
        <h1 id="all-fixtures-title">全部賽事</h1>
        <p>查看所有即將開賽賽事及市場分析。</p>
      </header>
      {props.marketNavigation}
      <div className="all-fixtures__content">{props.content}</div>
    </section>
  );
}
