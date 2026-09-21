import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

function Smoke() {
  return (
    <main className="min-h-dvh grid place-items-center bg-neutral-50 dark:bg-neutral-950">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">墨枢 NovelForge</h1>
        <p className="text-sm opacity-60">HeroUI + Tailwind v4 冒烟测试</p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Smoke />
  </StrictMode>,
);
