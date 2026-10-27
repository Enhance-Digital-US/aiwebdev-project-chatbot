import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type SuggestionsProps = Omit<ComponentProps<"div">, "children"> & {
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
};

export const Suggestions = ({ suggestions, onSuggestionClick, className, ...props }: SuggestionsProps) => (
  <div className={cn("flex flex-wrap gap-2", className)} {...props}>
    {suggestions.map((suggestion) => (
      <Button
        key={suggestion}
        type="button"
        variant="outline"
        size="sm"
        className="h-auto rounded-full px-3 py-1.5 text-left whitespace-normal"
        onClick={() => onSuggestionClick(suggestion)}
      >
        {suggestion}
      </Button>
    ))}
  </div>
);
