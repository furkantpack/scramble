import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-5"><Skeleton className="h-28 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-[420px] rounded-2xl" /></div>;
}
