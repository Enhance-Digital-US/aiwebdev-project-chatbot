import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlertIcon } from "lucide-react";

export type ConfirmationState = "pending" | "approved" | "cancelled";

export type ConfirmationProps = {
  /** Which server is asking, e.g. "issue-tracker". */
  server: string;
  /** The server's own words, e.g. 'Delete project "Demo" and all 8 issues?'. */
  message: string;
  state: ConfirmationState;
  onApprove: () => void;
  onCancel: () => void;
};

/** A tool call that paused for the user's confirmation (MCP elicitation). */
export const Confirmation = ({ server, message, state, onApprove, onCancel }: ConfirmationProps) => (
  <Card className="my-2 max-w-md gap-3 border-amber-500/50 py-4" role="alertdialog" aria-label="Confirmation needed">
    <CardHeader className="px-4">
      <CardTitle className="flex items-center gap-2 text-sm">
        <ShieldAlertIcon className="size-4 text-amber-600" />
        Confirmation needed
      </CardTitle>
      <CardDescription className="text-xs">{server} asks:</CardDescription>
    </CardHeader>
    <CardContent className="px-4 text-sm">{message}</CardContent>
    <CardFooter className="gap-2 px-4">
      {state === "pending" ? (
        <>
          <Button size="sm" variant="destructive" onClick={onApprove}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {state === "approved" ? "Approved" : "Cancelled"}
        </span>
      )}
    </CardFooter>
  </Card>
);
