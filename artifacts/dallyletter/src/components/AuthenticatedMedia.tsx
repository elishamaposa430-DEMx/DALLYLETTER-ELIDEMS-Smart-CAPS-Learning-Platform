import { useEffect, useState } from "react";
import { resolveBaseUrl } from "@workspace/api-client-react";

interface AuthenticatedMediaProps {
  src: string;
  type: string;
  title: string;
}

function isExternalEmbed(src: string): boolean {
  try {
    const url = new URL(src, window.location.href);
    return url.hostname === "www.youtube.com" || url.hostname === "youtube.com" || url.hostname === "youtu.be";
  } catch {
    return false;
  }
}

export function AuthenticatedMedia({ src, type, title }: AuthenticatedMediaProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isExternalEmbed(src)) return;

    let active = true;
    const token = localStorage.getItem("dallyletter_token");
    fetch(resolveBaseUrl(src), { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((response) => {
        if (!response.ok) throw new Error("Media unavailable");
        return response.blob();
      })
      .then((blob) => {
        if (active) setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
      setObjectUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [src]);

  if (isExternalEmbed(src)) {
    return <iframe title={title} src={src} className="w-full aspect-video rounded-md border" allowFullScreen />;
  }

  if (error) return <p className="text-sm text-destructive">Media could not be loaded.</p>;
  if (!objectUrl) return <p className="text-sm text-muted-foreground">Loading media…</p>;

  if (type === "video") return <video controls preload="metadata" className="w-full max-h-[360px] rounded-md bg-black" src={objectUrl} />;
  if (type === "audio") return <audio controls className="w-full" src={objectUrl} />;
  if (type === "image") return <img src={objectUrl} alt={title} className="w-full max-h-[360px] rounded-md object-contain" />;
  if (type === "notes" || type === "mixed") return <iframe title={title} src={objectUrl} className="w-full h-[360px] rounded-md border" />;

  return null;
}
