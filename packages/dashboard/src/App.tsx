import { useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { useSummary } from "./hooks/useSummary";
import type { TimespanParam } from "./lib/api";

export function App() {
  const [timespan, setTimespan] = useState<TimespanParam>("7");
  const [showBots, setShowBots] = useState(false);
  const { data, loading, error } = useSummary(timespan);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        timespan={timespan}
        onTimespanChange={setTimespan}
        showBots={showBots}
        onShowBotsChange={setShowBots}
      />
      <main>
        <Dashboard
          data={data}
          loading={loading}
          error={error}
          showBots={showBots}
        />
      </main>
    </div>
  );
}
