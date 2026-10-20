"use client";

import { Badge } from "@/components/ui/badge";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
} from "@/components/ui/code-block";
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
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

export type ToolProps = ComponentProps<typeof TraceCollapsible>;

// Trace is the list container; open/onOpenChange belong to the collapsible.
export const Tool = ({ className, ...props }: ToolProps) => (
  <Trace className={cn("not-prose mb-4", className)}>
    <TraceCollapsible {...props} />
  </Trace>
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

const getTraceLine = (
  state: ToolPart["state"],
  name: string
): { status?: "running" | "error" | "pending"; title: string } => {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return { status: "running", title: `Running ${name}` };
    case "output-available":
      return { title: `Ran ${name}` };
    case "output-error":
      return { status: "error", title: `Failed to run ${name}` };
    case "output-denied":
      return { status: "error", title: `Denied ${name}` };
    case "approval-requested":
    case "approval-responded":
      return { status: "pending", title: `Waiting to run ${name}` };
  }
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  const line = getTraceLine(state, title ?? derivedName);

  return (
    <TraceCollapsibleTrigger className={className}>
      <TraceLine status={line.status}>
        <TraceIcon>
          <WrenchIcon />
        </TraceIcon>
        <TraceTitle>{line.title}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof TraceCollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <TraceCollapsibleContent
    className={cn("space-y-4", className)}
    {...props}
  />
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
      <CodeBlockContent wrap className="max-h-64">
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
};

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  if (input == null) return null;
  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </h4>
      <HighlightedCode code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (errorText) {
    Output = (
      <HighlightedCode code={errorText} language="text" variant="destructive" />
    );
  } else if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <HighlightedCode code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <HighlightedCode code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      {Output}
    </div>
  );
};
