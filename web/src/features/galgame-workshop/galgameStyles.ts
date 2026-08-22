// These bundles share a deliberate cascade. Load the broad shell and feature
// rules first, then the script-workbench overrides last. Parallel imports make
// the winner depend on network timing and can change panel geometry per load.
await import("@features/galgame-workshop/styles/galgame-shell.css");
await import("@features/galgame-workshop/styles/story-authoring.css");
await import("@features/galgame-workshop/styles/character-stage.css");
await import("@features/galgame-workshop/styles/assets-and-player.css");
await import("@features/galgame-workshop/galgame-script-workbench.css");

export {};
