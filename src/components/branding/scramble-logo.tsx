import { cn } from "@/lib/utils";

export function ScrambleMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0", className)}
      fill="none"
      viewBox="0 0 100 116"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M50 4C25 4 5 28 5 58s20 54 45 54 45-24 45-54S75 4 50 4Z" stroke="#FFC400" strokeWidth="5" />
      <path d="M50 25C34 25 23 40 23 58s11 33 27 33 27-15 27-33-11-33-27-33Z" stroke="#FFC400" strokeWidth="5" />
    </svg>
  );
}

export function ScrambleLogo({
  className,
  markClassName,
  wordmarkClassName,
  inverse = false,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  inverse?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <ScrambleMark className={cn("h-10 w-auto", markClassName)} />
      <span
        className={cn(
          "font-bold font-sans text-[28px] leading-none tracking-[-0.065em]",
          inverse ? "text-white" : "text-zinc-950",
          wordmarkClassName,
        )}
      >
        scramble
      </span>
    </span>
  );
}
