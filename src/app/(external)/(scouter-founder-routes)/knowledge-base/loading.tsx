import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-5"><Skeleton className="h-28 rounded-2xl" /><div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]"><Skeleton className="h-[560px] rounded-xl" /><Skeleton className="h-[560px] rounded-xl" /></div></div>;
}
