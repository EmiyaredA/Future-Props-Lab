import { ArrowRight, BookOpen } from "lucide-react";
import "./navigation.css";

export function DocumentCard({
  title,
  summary,
  href,
  featured = false,
  eyebrow,
  onOpen,
}: {
  title: string;
  summary?: string;
  href?: string;
  featured?: boolean;
  eyebrow?: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {!featured && (
        <span className="document-card-icon">
          <BookOpen size={20} aria-hidden />
        </span>
      )}
      <span className="document-card-copy">
        {eyebrow && <small className="document-card-eyebrow">{eyebrow}</small>}
        <strong>{title}</strong>
        {summary && <span className="document-card-summary">{summary}</span>}
        {featured && href && (
          <span className="document-card-cta">
            开始阅读 <ArrowRight size={18} aria-hidden />
          </span>
        )}
      </span>
      {featured ? (
        <BookOpen className="document-card-decoration" size={64} aria-hidden />
      ) : (
        <ArrowRight className="document-card-arrow" size={18} aria-hidden />
      )}
    </>
  );
  const className = `document-card ${featured ? "is-featured" : ""}`;
  return href ? (
    <a
      className={className}
      href={href}
      onClick={
        onOpen
          ? (event) => {
              if (
                event.button ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onOpen();
            }
          : undefined
      }
    >
      {content}
    </a>
  ) : (
    <div className={`${className} is-unavailable`} aria-disabled="true">
      {content}
    </div>
  );
}
