import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-5"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-14 rounded-xl" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[420px] rounded-2xl" />)}</div></div>;
}
