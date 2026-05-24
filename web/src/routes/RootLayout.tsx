import { NavLink, Outlet } from "react-router-dom";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "font-mono text-xs uppercase tracking-widest transition-colors",
    isActive ? "text-fg" : "text-fg-subtle hover:text-fg",
  ].join(" ");

export function RootLayout() {
  return (
    <div className="min-h-full">
      <header className="border-b border-border bg-surface-raised">
        <nav className="mx-auto flex max-w-6xl items-baseline gap-8 px-6 py-4">
          <NavLink to="/" end className="font-serif text-lg text-fg">
            Tutor
          </NavLink>
          <NavLink to="/cards" className={navClass}>
            Browse
          </NavLink>
          <NavLink to="/collections" className={navClass}>
            Collections
          </NavLink>
          <NavLink to="/decks" className={navClass}>
            Decks
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
