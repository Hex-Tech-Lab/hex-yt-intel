export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse space-y-4 p-4 border border-gray-700 rounded-lg ${className || ''}`}>
      <div className="h-4 bg-gray-700 rounded w-3/4"></div>
      <div className="h-64 bg-gray-700 rounded w-full"></div>
    </div>
  );
}
