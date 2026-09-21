import { useEffect, useState } from "react";

export function AuthenticatedAudio({ src, className }: { src: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem("dallyletter_token");
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(response => {
        if (!response.ok) throw new Error("Audio unavailable");
        return response.blob();
      })
      .then(blob => {
        if (active) setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => setObjectUrl(null));
    return () => {
      active = false;
      setObjectUrl(current => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [src]);

  return objectUrl ? <audio controls className={className} src={objectUrl} /> : <span className="text-xs text-muted-foreground">Loading voice message…</span>;
}