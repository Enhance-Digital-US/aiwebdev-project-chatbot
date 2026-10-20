import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type ModelSelectorProps = ComponentProps<typeof DropdownMenu>;

export const ModelSelector = (props: ModelSelectorProps) => (
  <DropdownMenu {...props} />
);

export type ModelSelectorTriggerProps = ComponentProps<
  typeof DropdownMenuTrigger
>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DropdownMenuTrigger asChild {...props} />
);

export type ModelSelectorContentProps = ComponentProps<
  typeof DropdownMenuContent
> & {
  title?: ReactNode;
};

export const ModelSelectorContent = ({
  className,
  title = "Model Selector",
  ...props
}: ModelSelectorContentProps) => (
  <DropdownMenuContent
    align="start"
    aria-label={typeof title === "string" ? title : undefined}
    className={cn("min-w-56", className)}
    {...props}
  />
);

// A menu has no search field. These stay on Command for a searchable
// palette (ModelSelectorDialog), and are not used inside ModelSelectorContent.
export type ModelSelectorDialogProps = ComponentProps<typeof CommandDialog>;

export const ModelSelectorDialog = (props: ModelSelectorDialogProps) => (
  <CommandDialog {...props} />
);

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>;

export const ModelSelectorInput = ({
  className,
  ...props
}: ModelSelectorInputProps) => (
  <CommandInput className={cn("h-auto py-3.5", className)} {...props} />
);

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <CommandEmpty {...props} />
);

export type ModelSelectorListProps = ComponentProps<
  typeof DropdownMenuRadioGroup
>;

export const ModelSelectorList = (props: ModelSelectorListProps) => (
  <DropdownMenuRadioGroup {...props} />
);

export type ModelSelectorGroupProps = ComponentProps<
  typeof DropdownMenuGroup
> & {
  heading?: ReactNode;
};

export const ModelSelectorGroup = ({
  heading,
  children,
  ...props
}: ModelSelectorGroupProps) => (
  <DropdownMenuGroup {...props}>
    {heading && <DropdownMenuLabel>{heading}</DropdownMenuLabel>}
    {children}
  </DropdownMenuGroup>
);

export type ModelSelectorItemProps = ComponentProps<
  typeof DropdownMenuRadioItem
>;

export const ModelSelectorItem = ({
  className,
  ...props
}: ModelSelectorItemProps) => (
  <DropdownMenuRadioItem className={cn("gap-2", className)} {...props} />
);

export type ModelSelectorShortcutProps = ComponentProps<
  typeof DropdownMenuShortcut
>;

export const ModelSelectorShortcut = (props: ModelSelectorShortcutProps) => (
  <DropdownMenuShortcut {...props} />
);

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof DropdownMenuSeparator
>;

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
  <DropdownMenuSeparator {...props} />
);

export type ModelSelectorLogoProps = Omit<
  ComponentProps<"img">,
  "src" | "alt"
> & {
  provider:
    | "moonshotai-cn"
    | "lucidquery"
    | "moonshotai"
    | "zai-coding-plan"
    | "alibaba"
    | "xai"
    | "vultr"
    | "nvidia"
    | "upstage"
    | "groq"
    | "github-copilot"
    | "mistral"
    | "vercel"
    | "nebius"
    | "deepseek"
    | "alibaba-cn"
    | "google-vertex-anthropic"
    | "venice"
    | "chutes"
    | "cortecs"
    | "github-models"
    | "togetherai"
    | "azure"
    | "baseten"
    | "huggingface"
    | "opencode"
    | "fastrouter"
    | "google"
    | "google-vertex"
    | "cloudflare-workers-ai"
    | "inception"
    | "wandb"
    | "openai"
    | "zhipuai-coding-plan"
    | "perplexity"
    | "openrouter"
    | "zenmux"
    | "v0"
    | "iflowcn"
    | "synthetic"
    | "deepinfra"
    | "zhipuai"
    | "submodel"
    | "zai"
    | "inference"
    | "requesty"
    | "morph"
    | "lmstudio"
    | "anthropic"
    | "aihubmix"
    | "fireworks-ai"
    | "modelscope"
    | "llama"
    | "scaleway"
    | "amazon-bedrock"
    | "cerebras"
    // oxlint-disable-next-line typescript-eslint(ban-types) -- intentional pattern for autocomplete-friendly string union
    | (string & {});
};

export const ModelSelectorLogo = ({
  provider,
  className,
  ...props
}: ModelSelectorLogoProps) => (
  <img
    {...props}
    alt={`${provider} logo`}
    className={cn("size-3 dark:invert", className)}
    height={12}
    src={`https://models.dev/logos/${provider}.svg`}
    width={12}
  />
);

export type ModelSelectorLogoGroupProps = ComponentProps<"div">;

export const ModelSelectorLogoGroup = ({
  className,
  ...props
}: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "flex shrink-0 items-center -space-x-1 [&>img]:rounded-full [&>img]:bg-background [&>img]:p-px [&>img]:ring-1 dark:[&>img]:bg-foreground",
      className
    )}
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({
  className,
  ...props
}: ModelSelectorNameProps) => (
  <span className={cn("flex-1 truncate text-left", className)} {...props} />
);
