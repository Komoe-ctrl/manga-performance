"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Paperclip, X } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { USE_DB, downloadMessageAttachment, listMessages, markMessagesRead, sendClientMessage } from "@/lib/services";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

/** PDF, Excel, Word, PNG or JPG, 25 MB at most (the server checks again: this only saves a round trip). */
const ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".docx", ".png", ".jpg", ".jpeg"];
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_BODY_LENGTH = 5000;

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`);

export function MessagesView() {
  const { session } = useSession();
  const clientId = session?.role === "client" ? session.clientId : "";
  const thread = useAsync(() => listMessages(clientId), [clientId]);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | undefined>();
  const [sending, setSending] = useState(false);
  const marked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (clientId && thread.status === "success" && !marked.current) {
      marked.current = true;
      void markMessagesRead(clientId);
    }
  }, [clientId, thread.status]);

  // The newest message is what the client wants to see: scroll to it when the thread loads or grows.
  const count = thread.status === "success" ? thread.data.length : 0;
  useEffect(() => {
    if (count > 0) bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (thread.status === "loading") return <LoadingState />;
  if (thread.status === "error") return <ErrorState message="Messages indisponibles." onRetry={thread.reload} />;

  const messages = [...thread.data].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const clearAttachment = () => {
    setAttachment(undefined);
    // Without this, choosing the same file again would not trigger `change`.
    if (fileInput.current) fileInput.current.value = "";
  };

  function chooseFile(file: File | undefined) {
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      toast.error("Format non accepté : PDF, Excel, Word, PNG ou JPG.");
      return clearAttachment();
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`Fichier trop volumineux (${formatSize(file.size)}) : 25 Mo maximum.`);
      return clearAttachment();
    }
    setAttachment(file);
  }

  async function submit() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await sendClientMessage(clientId, body.trim(), attachment);
      setBody("");
      clearAttachment();
      thread.reload();
    } catch (error) {
      // The text and the file are kept: nothing to retype.
      toast.error(error instanceof Error ? error.message : "Envoi impossible, réessayez.");
    } finally {
      setSending(false);
    }
  }

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
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                {m.attachment &&
                  (USE_DB ? (
                    <button type="button" onClick={() => downloadMessageAttachment(m.id)} className="mt-1 flex items-center gap-1 text-xs underline opacity-90">
                      <Paperclip className="h-3 w-3" aria-hidden /> {m.attachment}
                    </button>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-xs opacity-80"><Paperclip className="h-3 w-3" aria-hidden /> {m.attachment}</p>
                  ))}
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
          <li ref={bottom} aria-hidden className="h-0" />
        </ol>
      )}

      <form
        className="space-y-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="msg" className="text-sm font-medium">Votre message</label>
        <Textarea
          id="msg"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          aria-describedby="msg-hint"
          onChange={(e) => setBody(e.target.value)}
          // Ctrl/Cmd + Enter sends; Enter alone keeps writing a new line.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <p id="msg-hint" className="text-xs text-muted-foreground">Ctrl + Entrée pour envoyer.</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {/* PDF, Excel, Word, PNG ou JPG, 25 Mo maximum (mode maquette : seul le nom est conservé). */}
            <label className="cursor-pointer underline focus-within:ring-2 focus-within:ring-accent">
              <Paperclip className="mr-1 inline h-4 w-4" aria-hidden />
              {attachment ? "Changer de fichier" : "Joindre un fichier"}
              <input
                ref={fileInput}
                type="file"
                accept={ALLOWED_EXTENSIONS.join(",")}
                className="sr-only"
                onChange={(e) => chooseFile(e.target.files?.[0])}
              />
            </label>
            {attachment && (
              <span className="flex min-w-0 items-center gap-1 rounded-full border border-border bg-muted py-1 pl-3 pr-1 text-xs" data-testid="attachment-chip">
                <span className="max-w-56 truncate" title={attachment.name}>{attachment.name}</span>
                <span className="shrink-0 text-muted-foreground">· {formatSize(attachment.size)}</span>
                <button
                  type="button"
                  onClick={clearAttachment}
                  aria-label={`Retirer la pièce jointe ${attachment.name}`}
                  className="rounded-full p-1 hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            )}
          </div>
          <Button type="submit" disabled={sending || !body.trim()}>{sending ? "Envoi…" : "Envoyer"}</Button>
        </div>
      </form>
    </div>
  );
}
