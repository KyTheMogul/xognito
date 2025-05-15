import * as React from "react";

export function Separator({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={`h-px w-full bg-zinc-700 ${className}`}
      {...props}
    />
  );
} 