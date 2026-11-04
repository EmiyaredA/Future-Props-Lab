import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import type { ApplicationDefinition } from "./catalog";
import "./applications.css";

export function ApplicationCard({
  application,
  onOpen,
}: {
  application: ApplicationDefinition;
  onOpen: (application: ApplicationDefinition) => void;
}) {
  const Icon = application.icon;
  return (
    <article className="application-card">
      <button
        type="button"
        aria-label={`打开${application.name}`}
        onClick={() => onOpen(application)}
      >
        <span className="application-icon">
          {application.brandImage ? (
            <ResponsiveImage
              src={application.brandImage}
              width={48}
              height={48}
              alt=""
              draggable={false}
            />
          ) : (
            <Icon aria-hidden />
          )}
        </span>
        <span className="application-copy">
          <strong>{application.name}</strong>
          <small title={application.description}>
            {application.description}
          </small>
          <span className="application-capabilities">
            {application.capabilities.slice(0, 2).map((item) => (
              <em key={item}>{item}</em>
            ))}
          </span>
        </span>
      </button>
    </article>
  );
}
