import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Icon } from "./icon";

interface DocsLinkProps {
  href: string;
  children: ReactNode;
  onOpen: (href: string) => boolean | void;
  className?: string;
}

export function DocsLink({ href, children, onOpen, className }: DocsLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-docs-link
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      onClick={(event) => {
        if (onOpen(href) !== false) event.preventDefault();
      }}
    >
      {children}
      <Icon name="ExternalLink" className="size-3 shrink-0" aria-hidden />
    </a>
  );
}
