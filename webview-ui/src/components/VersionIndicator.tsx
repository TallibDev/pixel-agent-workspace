/**
 * The app version as a plain, non-interactive label (bottom-right of the
 * office). Pixel Agent Workspace removed upstream's "What's New" notice and
 * changelog: they pointed at the original project's news and community links.
 */
export function VersionIndicator({ currentVersion }: { currentVersion: string }) {
  if (!currentVersion) return null;
  return (
    <div
      className="absolute bottom-8 right-12 z-20 text-sm select-none pointer-events-none"
      style={{ opacity: 0.5 }}
      aria-label={`Version ${currentVersion}`}
    >
      v{currentVersion}
    </div>
  );
}
