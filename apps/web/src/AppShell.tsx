import type { ReactNode } from "react";

type AppShellProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <main className="app-shell">
      <aside className="sidebar">{sidebar}</aside>
      <section className="main-pane">{children}</section>
    </main>
  );
}
