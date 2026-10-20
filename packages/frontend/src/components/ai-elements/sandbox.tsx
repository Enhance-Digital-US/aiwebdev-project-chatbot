"use client";

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
} from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";
import { PlayIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

export type SandboxProps = ComponentProps<typeof TraceCollapsible>;

export const Sandbox = ({ className, ...props }: SandboxProps) => (
  <Trace className={cn("not-prose mb-4", className)}>
    <TraceCollapsible defaultOpen {...props} />
  </Trace>
);

type SandboxState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

const statusConfig: Record<
  SandboxState,
  { verb: string; status?: "running" | "error" | "pending" }
> = {
  "input-streaming": { verb: "Writing", status: "running" },
  "input-available": { verb: "Running", status: "running" },
  "output-available": { verb: "Ran" },
  "output-error": { verb: "Failed to run", status: "error" },
};

export type SandboxHeaderProps = {
  title?: string;
  state: SandboxState;
  className?: string;
};

export const SandboxHeader = ({
  title,
  state,
  className,
}: SandboxHeaderProps) => {
  const { verb, status } = statusConfig[state] ?? statusConfig["input-streaming"];

  return (
    <TraceCollapsibleTrigger className={className}>
      <TraceLine status={status}>
        <TraceIcon>
          <PlayIcon />
        </TraceIcon>
        <TraceTitle>
          {verb} {title ?? "Sandbox"}
        </TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
};

export type SandboxContentProps = ComponentProps<
  typeof TraceCollapsibleContent
>;

export const SandboxContent = (props: SandboxContentProps) => (
  <TraceCollapsibleContent {...props} />
);

const HighlightedCode = ({
  code,
  language,
  variant,
}: {
  code: string;
  language: string;
  variant?: "default" | "destructive";
}) => {
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock size="sm" variant={variant}>
      <CodeBlockContent wrap className="max-h-80">
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
};

export type SandboxTabsProps = {
  code: string;
  language: string;
  output?: string;
  stderr?: string;
  // True once the tool call has settled (output-available or output-error).
  isComplete?: boolean;
};

// What the Output tab shows when there is no stdout/stderr to render.
// TODO(you): a finished run with no output currently still says
// "Waiting for output..." — decide what a settled, silent run should show.
// (Drop the leading underscore once you use the parameter.)
const getEmptyOutputMessage = (_isComplete: boolean): string => {
  return "Waiting for output...";
};

export const SandboxTabs = ({
  code,
  language,
  output,
  stderr,
  isComplete = false,
}: SandboxTabsProps) => {
  const hasOutput = !!output || !!stderr;

  const [tab, setTab] = useState(hasOutput ? "output" : "code");
  useEffect(() => {
    if (hasOutput) setTab("output");
  }, [hasOutput]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-2">
      <TabsList className="h-8">
        <TabsTrigger value="code" className="text-xs">
          Code
        </TabsTrigger>
        <TabsTrigger value="output" className="text-xs">
          Output
        </TabsTrigger>
      </TabsList>
      <TabsContent value="code" className="mt-0">
        <HighlightedCode
          code={code}
          language={language === "python" ? "python" : "javascript"}
        />
      </TabsContent>
      <TabsContent value="output" className="mt-0 space-y-2">
        {hasOutput ? (
          <>
            {stderr && (
              <HighlightedCode code={stderr} language="ansi" variant="destructive" />
            )}
            {output && <HighlightedCode code={output} language="ansi" />}
          </>
        ) : (
          <div className="p-2 text-sm text-muted-foreground">
            {getEmptyOutputMessage(isComplete)}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
