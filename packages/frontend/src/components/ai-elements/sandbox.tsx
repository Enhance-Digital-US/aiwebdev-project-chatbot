"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  PlayIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useState } from "react";

import { CodeBlock } from "./code-block";

export type SandboxProps = ComponentProps<typeof Collapsible>;

export const Sandbox = ({ className, ...props }: SandboxProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    defaultOpen
    {...props}
  />
);

type SandboxState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

const statusConfig: Record<
  SandboxState,
  { label: string; icon: ReactNode }
> = {
  "input-streaming": {
    label: "Pending",
    icon: <ClockIcon className="size-3.5" />,
  },
  "input-available": {
    label: "Running",
    icon: <PlayIcon className="size-3.5 animate-pulse text-blue-500" />,
  },
  "output-available": {
    label: "Completed",
    icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
  },
  "output-error": {
    label: "Error",
    icon: <XCircleIcon className="size-3.5 text-red-600" />,
  },
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
  const { label, icon } = statusConfig[state] ?? statusConfig["input-streaming"];

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <PlayIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? "Sandbox"}</span>
        <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
          {icon}
          {label}
        </Badge>
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type SandboxContentProps = ComponentProps<typeof CollapsibleContent>;

export const SandboxContent = ({
  className,
  ...props
}: SandboxContentProps) => (
  <CollapsibleContent
    className={cn("border-t", className)}
    {...props}
  />
);

export type SandboxTabsProps = {
  code: string;
  language: string;
  output?: string;
  stderr?: string;
};

export const SandboxTabs = ({
  code,
  language,
  output,
  stderr,
}: SandboxTabsProps) => {
  const hasOutput = !!output || !!stderr;
  const displayOutput = stderr
    ? `${stderr}${output ? `\n${output}` : ""}`
    : output ?? "";

  const [tab, setTab] = useState(hasOutput ? "output" : "code");
  useEffect(() => {
    if (hasOutput) setTab("output");
  }, [hasOutput]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex items-center border-b bg-muted/30 px-3">
        <TabsList className="h-9 bg-transparent p-0">
          <TabsTrigger
            value="code"
            className="rounded-none border-b-2 border-transparent px-3 pb-2.5 pt-2 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Code
          </TabsTrigger>
          <TabsTrigger
            value="output"
            className="rounded-none border-b-2 border-transparent px-3 pb-2.5 pt-2 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Output
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="code" className="mt-0">
        <CodeBlock code={code} language={language === "python" ? "python" : "javascript"} />
      </TabsContent>
      <TabsContent value="output" className="mt-0">
        {hasOutput ? (
          <CodeBlock code={displayOutput} language="log" />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Waiting for output...
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
