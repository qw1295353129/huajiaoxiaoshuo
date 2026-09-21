import { useEffect, useRef, useState } from "react";
import { Timer, Play, Pause, RotateCcw } from "lucide-react";
import { formatClock } from "@/utils/format";

const PRESETS = [15, 25, 45];

/** 状态栏里的番茄钟：默认 25 分钟，完成后把这段时间的新增字数回调出去。 */
export function PomodoroTimer({ onComplete }: { onComplete: (minutes: number, wordsAdded: number) => void }) {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const baseline = useRef<number>(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          onComplete(minutes, 0);
          return minutes * 60;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, minutes, onComplete]);

  const start = () => {
    baseline.current = 0;
    setRemaining(minutes * 60);
    setRunning(true);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tabular flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-black/5 dark:hover:bg-white/10"
        title="番茄钟"
      >
        <Timer className="size-3" />
        {formatClock(remaining)}
      </button>

      {open && (
        <div className="absolute bottom-6 right-0 z-50 w-48 rounded-xl border border-black/10 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-neutral-900">
          <div className="mb-2 flex justify-center gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setMinutes(p);
                  setRemaining(p * 60);
                  setRunning(false);
                }}
                className={
                  "rounded px-2 py-0.5 text-[11px] transition " +
                  (minutes === p ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "opacity-55 hover:opacity-90")
                }
              >
                {p}分
              </button>
            ))}
          </div>
          <p className="tabular mb-2 text-center text-2xl font-semibold">{formatClock(remaining)}</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => (running ? setRunning(false) : remaining === minutes * 60 ? start() : setRunning(true))}
              className="rounded-lg bg-violet-500 px-3 py-1 text-xs text-white transition hover:bg-violet-600"
            >
              {running ? <Pause className="size-3" /> : <Play className="size-3" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                setRemaining(minutes * 60);
              }}
              className="rounded-lg border border-black/10 px-3 py-1 text-xs transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              <RotateCcw className="size-3" />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] opacity-50">专注写作，不打断心流</p>
        </div>
      )}
    </div>
  );
}
