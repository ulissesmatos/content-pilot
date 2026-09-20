import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="gap-2 py-3 sm:gap-6 sm:py-6">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-0 sm:px-6 sm:pb-2">
        <CardTitle className="text-muted-foreground truncate text-xs font-medium sm:text-sm">{title}</CardTitle>
        <Icon className="text-muted-foreground size-3.5 shrink-0 sm:size-4" />
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <div className="text-lg font-semibold tabular-nums sm:text-2xl">{value}</div>
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
