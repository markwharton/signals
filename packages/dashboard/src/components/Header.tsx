import { DarkModeToggle } from "@/components/DarkModeToggle";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TimespanParam } from "@/lib/api";

interface HeaderProps {
  sites: string[];
  selectedSite: string;
  onSelectedSiteChange: (value: string) => void;
  timespan: TimespanParam;
  onTimespanChange: (value: TimespanParam) => void;
  showBots: boolean;
  onShowBotsChange: (value: boolean) => void;
}

export function Header({
  sites,
  selectedSite,
  onSelectedSiteChange,
  timespan,
  onTimespanChange,
  showBots,
  onShowBotsChange,
}: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight">signals</h1>
      <div className="flex flex-wrap items-center gap-4">
        {sites.length > 1 ? (
          <select
            value={selectedSite}
            onChange={(e) => onSelectedSiteChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
        <Tabs
          value={timespan}
          onValueChange={(v) => onTimespanChange(v as TimespanParam)}
        >
          <TabsList>
            <TabsTrigger value="7">7 days</TabsTrigger>
            <TabsTrigger value="30">30 days</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm select-none">
          <Switch checked={showBots} onCheckedChange={onShowBotsChange} />
          Show bots
        </label>
        <DarkModeToggle />
      </div>
    </header>
  );
}
