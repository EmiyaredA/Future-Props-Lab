import { useEffect, useState } from "react";
import {
  getDocument,
  listProjects,
  type PetDocument,
  type PetProject,
} from "@features/desktop-pet/api";

type HeroFigure =
  (typeof import("@features/desktop-pet/DesktopPetFigure"))["DesktopPetFigure"];

function mentionsKurisu(project: PetProject) {
  return (
    project.title.includes("红莉栖") || project.sourceTitle.includes("红莉栖")
  );
}

function selectKurisuProject(projects: PetProject[]) {
  return projects
    .filter(mentionsKurisu)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function HomeOrbit() {
  return (
    <div className="home-orbit" aria-hidden="true">
      <span className="home-orbit-glow" />
      <span className="home-orbit-ring home-orbit-ring--one" />
      <span className="home-orbit-ring home-orbit-ring--two" />
      <span className="home-orbit-ring home-orbit-ring--three" />
      <span className="home-orbit-core" />
    </div>
  );
}

export function HomeHeroPet() {
  const [pet, setPet] = useState<PetDocument | null>(null);
  const [Figure, setFigure] = useState<HeroFigure | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const projects = await listProjects();
        const match = selectKurisuProject(projects.items);
        if (!match || cancelled) return;
        const [loaded, module] = await Promise.all([
          getDocument(match.id),
          import("@features/desktop-pet/DesktopPetFigure"),
        ]);
        if (cancelled) return;
        setPet(loaded);
        setFigure(() => module.DesktopPetFigure);
      } catch {
        // 没有可读的红莉栖项目时保留轨道装饰。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pet || !Figure) return <HomeOrbit />;
  return (
    <div className="home-hero-pet" aria-hidden="true">
      <Figure
        document={pet}
        view="center"
        eventName="idle"
        playbackMode="runtime"
      />
    </div>
  );
}
