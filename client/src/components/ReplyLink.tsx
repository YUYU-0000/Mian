import { useEffect, useState, type ReactNode } from "react";

const fileLinks = new Map<string, Promise<boolean>>();

export default function ReplyLink({ href = "", title, children }: {
  href?: string;
  title?: string;
  children: ReactNode;
}) {
  const url = document.createElement("a");
  url.href = href || "#";
  const conversationFile = url.origin === location.origin && /^\/api\/conversations\/[^/]+\/files\/[^/]+$/.test(url.pathname);
  const external = /^(?:https?:|mailto:|tel:|\/\/|#)/i.test(href) && !(url.origin === location.origin && url.pathname.startsWith("/api/conversations/"));
  const [verified, setVerified] = useState("");
  useEffect(() => {
    if (!conversationFile) return;
    let active = true;
    let request = fileLinks.get(url.href);
    if (!request) {
      request = fetch(url.href, { method: "HEAD" }).then(response => response.ok, () => false);
      fileLinks.set(url.href, request);
    }
    void request.then(exists => { if (active) setVerified(exists ? href : ""); });
    return () => { active = false; };
  }, [href, conversationFile, url.href]);
  return external || (conversationFile && verified === href)
    ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    : <>{children}</>;
}
