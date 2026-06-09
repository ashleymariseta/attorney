import { SkeletonCard, Skeleton } from '@/components/Skeleton';

export default function AppLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="mb-8 h-3 w-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <div className="mt-6 space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
