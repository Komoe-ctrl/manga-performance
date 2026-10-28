"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Paperclip } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { listMessages, markMessagesRead, sendClientMessage } from "@/lib/services";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

export function MessagesView() {
  const { session } = useSession();
  const clientId = session?.role === "client" ? session.clientId : "";
  const thread = useAsync(() => listMessages(clientId), [clientId]);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    if (clientId && thread.status === "success" && !marked.current) {
      marked.current = true;
      void markMessagesRead(clientId);
    }
  }, [clientId, thread.status]);

  if (thread.status === "loading") return <LoadingState />;
  if (thread.status === "error") return <ErrorState message="Messages indisponibles." onRetry={thread.reload} />;

  const messages = [...thread.data].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Échanges asynchrones : le consultant répond sous 24 h ouvrées.</p>
      {messages.length === 0 ? (
        <EmptyState message="Aucun message. Écrivez à votre consultant ci-dessous." />
      ) : (
        <ol className="space-y-3" aria-label="Fil de discussion">
          {messages.map((m) => (
            <li key={m.id} className={cn("flex", m.from === "client" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-lg p-3 text-sm", m.from === "client" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                <p>{m.body}</p>
                {m.attachment && (
                  <p className="mt-1 flex items-center gap-1 text-xs opacity-80"><Paperclip className="h-3 w-3" aria-hidden /> {m.attachment}</p>
                )}
                <p className="mt-1 flex items-center justify-end gap-1 text-xs opacity-70">
                  {formatDate(m.sentAt)}
                  {m.from === "client" &&
                    (m.read ? (
                      <><CheckCheck className="h-3 w-3" aria-hidden /><span className="sr-only">Lu</span></>
                    ) : (
                      <><Check className="h-3 w-3" aria-hidden /><span className="sr-only">Envoyé</span></>
                    ))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        className="space-y-2 border-t border-border pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setSending(true);
          await sendClientMessage(clientId, body.trim(), attachment);
          setBody("");
          setAttachment(undefined);
          setSending(false);
          thread.reload();
        }}
      >
        <label htmlFor="msg" className="text-sm font-medium">Votre message</label>
        <Textarea id="msg" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            {/* Pièce jointe simulée : seul le nom du fichier est conservé. */}
            <label className="cursor-pointer underline">
              <Paperclip className="mr-1 inline h-4 w-4" aria-hidden />
              Joindre un fichier
              <input type="file" className="sr-only" onChange={(e) => setAttachment(e.target.files?.[0]?.name)} />
            </label>
            {attachment && <span className="ml-2 text-muted-foreground">{attachment}</span>}
          </div>
          <Button type="submit" disabled={sending || !body.trim()}>Envoyer</Button>
        </div>
      </form>
    </div>
  );
}
